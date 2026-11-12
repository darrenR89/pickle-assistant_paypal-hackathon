// Delayed holds: approve now, hold later. Off unless DELAYED_HOLDS=on.
//
// A PayPal hold is only guaranteed for 3 days, so for a game further out than that the player
// saves their PayPal instead (a vault payment token). Two days before the game the scheduled job
// places the real hold from that token and tells the player. If PayPal refuses it, the player has
// a day to approve again before the spot goes to someone else. The token is deleted as soon as
// the hold is placed, fails, or the player is out.
//
// Deterministic code only, same as every other money path.

import { newId, one, q } from "@/lib/db";
import { type Game, type Spot, cancelRule, holdCents, logEvent, money, whenLabel } from "@/lib/games";
import { fixDeadline, holdDate } from "@/lib/limits";
import { deletePaymentToken, isTerminalPayPalError, placeVaultedHold } from "@/lib/paypal";
import { playerOut, postDm, postGroup, postJoinedLine, rosterLine, spotsRefilled, spotOfferFor, tagWaitlist } from "./assistant";

const dayLabel = (d: Date) => new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Los_Angeles" }).format(d);

/** Forget a saved payment method at PayPal. Best effort: a token that is already gone is fine. */
async function forget(token: string | null) {
  if (!token) return;
  await deletePaymentToken(token).catch((err) => console.error("couldn't delete a saved payment method", err));
}

/** Called once a player has approved saving their PayPal for a game that's still days away. */
export async function playerSaved(game: Game, personId: string, paymentTokenId: string) {
  const planned = holdCents(game);
  await q(
    `insert into spots (id, game_id, person_id, status, hold_cents, hold_status, vault_token)
     values ($1, $2, $3, 'in', $4, 'saved', $5)
     on conflict (game_id, person_id) do update set status = 'in', order_id = null, authorization_id = null,
       hold_cents = $4, hold_status = 'saved', vault_token = $5, hold_failed_at = null, late_cancel = null, updated_at = now()`,
    [newId("spot"), game.id, personId, planned, paymentTokenId],
  );
  await q("delete from intents where game_id = $1 and person_id = $2", [game.id, personId]);
  await logEvent(game.id, personId, "joined", { saved: true, holdCents: planned });

  const giver = await spotOfferFor(game.id, personId);
  if (giver) {
    await logEvent(game.id, giver, "spot_offer_done", { to: personId });
    await playerOut(game, giver, { replaced: true });
  }

  await postJoinedLine(game);
  await spotsRefilled(game, personId);
  await postDm(
    game.group_id,
    personId,
    `You're in for ${whenLabel(game.starts_at)}. Your PayPal is saved and nothing is held yet. I'll place the ${money(planned)} hold on ${dayLabel(holdDate(game.starts_at))} and tell you when I do. ` +
      `Your share is ${money(game.share_cents)}, charged after the game. Drop out before then and your PayPal is removed.`,
    game.slug,
  );
}

type SavedSpot = Spot & { name: string; token: string };

const spotWithPerson = (spotId: string, status: "saved" | "failed") =>
  one<SavedSpot>(
    "select s.*, p.name, p.token from spots s join people p on p.id = s.person_id where s.id = $1 and s.hold_status = $2 and s.status = 'in'",
    [spotId, status],
  );

/** Two days before the game: place the real hold from the saved payment method. */
export async function placeSavedHold(spotId: string) {
  const spot = await spotWithPerson(spotId, "saved");
  if (!spot?.vault_token) return "skipped";
  const game = await one<Game>("select * from games where id = $1", [spot.game_id]);
  if (!game || game.status !== "open") return "skipped";
  const amount = holdCents(game);
  let hold: Awaited<ReturnType<typeof placeVaultedHold>>;
  try {
    hold = await placeVaultedHold({
      paymentTokenId: spot.vault_token,
      amountCents: amount,
      description: `Pickleball ${whenLabel(game.starts_at)} · ${game.place} (hold)`,
      referenceId: game.slug,
      // Tied to the spot, so a retry after a timeout returns the same hold instead of a second one.
      // The token is part of it so a later, different saved method for the same spot gets a fresh try.
      requestId: `saved-hold-${spot.id}-${spot.vault_token.slice(-8)}`,
    });
  } catch (err) {
    if (!isTerminalPayPalError(err)) throw err;
    // PayPal refused it for good (declined, account closed, token removed). Ask the player to approve again.
    await q("update spots set hold_status = 'failed', hold_failed_at = now(), vault_token = null, updated_at = now() where id = $1", [spot.id]);
    await forget(spot.vault_token);
    await logEvent(game.id, spot.person_id, "saved_hold_failed");
    const by = whenLabel(fixDeadline(new Date(), game.starts_at));
    await postDm(
      game.group_id,
      spot.person_id,
      `I couldn't place your ${money(amount)} hold for ${whenLabel(game.starts_at)}: PayPal turned it down. Tap to approve it again by ${by}, or your spot goes to the next person.`,
      `${game.slug}?p=${spot.token}`,
      { always: true },
    );
    await postDm(
      game.group_id,
      game.organizer_id,
      `${spot.name}'s hold for ${whenLabel(game.starts_at)} didn't go through. They have until ${by} to approve it again, then their spot opens up.`,
      `${game.slug}?o=${game.organizer_token}`,
      { always: true },
    );
    return "failed";
  }
  await q(
    `update spots set authorization_id = $2, order_id = $3, hold_cents = $4, hold_status = 'held', authorized_at = now(),
       vault_token = null, updated_at = now() where id = $1`,
    [spot.id, hold.authorizationId, hold.orderId, amount],
  );
  await forget(spot.vault_token);
  await logEvent(game.id, spot.person_id, "saved_hold_placed", { authorizationId: hold.authorizationId, holdCents: amount });
  await postDm(
    game.group_id,
    spot.person_id,
    `Your ${money(amount)} hold for ${whenLabel(game.starts_at)} is now in place, and your saved PayPal has been removed. Nothing is charged until after the game; ${cancelRule(game)}.`,
    game.slug,
    { always: true },
  );
  return "placed";
}

/** The fix window ran out: give the spot to the next person. */
export async function freeFailedSpot(spotId: string) {
  const spot = await spotWithPerson(spotId, "failed");
  if (!spot?.hold_failed_at) return "skipped";
  const game = await one<Game>("select * from games where id = $1", [spot.game_id]);
  if (!game || game.status !== "open" || spot.person_id === game.organizer_id) return "skipped";
  if (Date.now() < fixDeadline(spot.hold_failed_at, game.starts_at).getTime()) return "waiting";
  const freed = await q("update spots set status = 'out', hold_status = 'none', updated_at = now() where id = $1 and hold_status = 'failed' returning id", [spot.id]);
  if (!freed.length) return "skipped";
  await logEvent(game.id, spot.person_id, "out", { late: false, holdFailed: true });
  // The group only hears that a spot is open, never why.
  await postGroup(game.group_id, `${spot.name} is out. ${await rosterLine(game)}`);
  await tagWaitlist(game);
  await postDm(game.group_id, spot.person_id, `Your spot for ${whenLabel(game.starts_at)} was released because the hold never went through. Nothing was charged. If there's still room, tap to join again:`, game.slug, { always: true });
  return "freed";
}

/**
 * A player with a saved method (or a failed hold) left, or the game closed: nothing is held, so
 * just forget the payment method. Returns the people affected.
 */
export async function dropSavedMethods(gameId: string, personId?: string) {
  const rows = await q<{ id: string; person_id: string; vault_token: string | null }>(
    `update spots s set hold_status = 'none', vault_token = null, hold_failed_at = null, updated_at = now()
     from (select id, vault_token from spots where game_id = $1 and hold_status in ('saved', 'failed') and ($2::text is null or person_id = $2) for update) old
     where s.id = old.id returning s.id, s.person_id, old.vault_token`,
    [gameId, personId ?? null],
  );
  for (const r of rows) await forget(r.vault_token);
  return rows.map((r) => r.person_id);
}
