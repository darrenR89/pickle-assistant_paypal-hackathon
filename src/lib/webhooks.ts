// Applies a verified PayPal webhook event to our records. Called by /api/paypal/webhook.

import { one, q } from "@/lib/db";
import { type Game, logEvent, money } from "@/lib/games";
import { postDm } from "@/bot/assistant";

export type PayPalEvent = { id: string; event_type: string; resource: Record<string, unknown> & { id?: string } };
type Event = PayPalEvent;

type SpotRow = { id: string; game_id: string; person_id: string; hold_status: string; name: string };

async function spotBy(column: "authorization_id" | "capture_id", id: string | undefined) {
  if (!id) return undefined;
  return one<SpotRow>(
    `select s.id, s.game_id, s.person_id, s.hold_status, p.name from spots s join people p on p.id = s.person_id where s.${column} = $1`,
    [id],
  );
}

const gameById = (id: string) => one<Game>("select * from games where id = $1", [id]);
const orgLink = (g: Game) => `${g.slug}?o=${g.organizer_token}`;

export async function handleWebhookEvent(event: Event) {
  const r = event.resource;
  switch (event.event_type) {
    case "PAYMENT.AUTHORIZATION.VOIDED": {
      // We void holds ourselves; this also catches holds that PayPal expired.
      const spot = await spotBy("authorization_id", r.id);
      if (!spot || spot.hold_status !== "held") return;
      await q("update spots set hold_status = 'voided', updated_at = now() where id = $1", [spot.id]);
      await logEvent(spot.game_id, spot.person_id, "hold_expired", { authorizationId: r.id });
      const game = await gameById(spot.game_id);
      if (game?.status === "open") {
        await postDm(game.group_id, game.organizer_id, `${spot.name}'s PayPal hold expired, so their spot isn't covered anymore.`, orgLink(game), { always: true });
      }
      return;
    }
    case "PAYMENT.CAPTURE.COMPLETED":
    case "PAYMENT.CAPTURE.DENIED":
    case "PAYMENT.CAPTURE.DECLINED": {
      const related = (r.supplementary_data as { related_ids?: { authorization_id?: string } } | undefined)?.related_ids;
      const spot = (await spotBy("capture_id", r.id)) ?? (await spotBy("authorization_id", related?.authorization_id));
      if (!spot) return;
      if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
        await q("update spots set capture_id = coalesce(capture_id, $2) where id = $1", [spot.id, r.id]);
        await logEvent(spot.game_id, spot.person_id, "capture_confirmed", { captureId: r.id });
        return;
      }
      // Nothing was collected after all, so it must not count toward the organizer's payout.
      await q("update spots set hold_status = 'voided', captured_cents = 0, updated_at = now() where id = $1 and hold_status = 'captured'", [spot.id]);
      await logEvent(spot.game_id, spot.person_id, "capture_failed", { captureId: r.id, status: r.status });
      const game = await gameById(spot.game_id);
      if (game) await postDm(game.group_id, game.organizer_id, `PayPal declined the charge for ${spot.name}. Their share wasn't collected.`, orgLink(game), { always: true });
      return;
    }
    case "PAYMENT.CAPTURE.REFUNDED": {
      // The resource is the refund; its "up" link points at the capture it refunds.
      const links = (r.links as Array<{ rel: string; href: string }> | undefined) ?? [];
      const captureId = links.find((l) => l.rel === "up")?.href.split("/").pop();
      const spot = await spotBy("capture_id", captureId);
      if (spot) await logEvent(spot.game_id, spot.person_id, "refund_confirmed", { refundId: r.id, captureId });
      return;
    }
    default:
      if (event.event_type.startsWith("PAYMENT.PAYOUTSBATCH.") || event.event_type.startsWith("PAYMENT.PAYOUTS-ITEM.")) return payoutUpdate(event);
  }
}

/** A payout batch or item changed. Map PayPal's status onto the game's payout status and tell the organizer. */
async function payoutUpdate(event: Event) {
  const r = event.resource as {
    payout_batch_id?: string;
    transaction_status?: string;
    batch_header?: { payout_batch_id?: string; batch_status?: string };
    errors?: { message?: string };
  };
  const batchId = r.batch_header?.payout_batch_id ?? r.payout_batch_id;
  if (!batchId) return;
  const game = await one<Game>("select * from games where payout_batch_id = $1", [batchId]);
  if (!game) return;
  const raw = r.transaction_status ?? r.batch_header?.batch_status ?? "";
  const next =
    ["SUCCESS"].includes(raw) ? "sent" :
    ["UNCLAIMED", "ONHOLD"].includes(raw) ? "unclaimed" :
    ["FAILED", "RETURNED", "BLOCKED", "DENIED", "REFUNDED", "REVERSED", "CANCELED"].includes(raw) ? "failed" :
    null;
  if (!next || next === game.payout_status) return;
  // A returned or failed payout means no money left, so the next try may be a new batch.
  await q("update games set payout_status = $2, payout_error = $3, payout_round = payout_round + $4 where id = $1", [
    game.id,
    next,
    next === "failed" ? (r.errors?.message ?? raw.toLowerCase()) : null,
    next === "failed" ? 1 : 0,
  ]);
  await logEvent(game.id, game.organizer_id, `payout_${next}`, { batchId, status: raw });
  const amount = money(game.payout_cents ?? 0);
  const text =
    next === "sent" ? `Your ${amount} landed. You're all square for this game.` :
    next === "unclaimed" ? `Your ${amount} is waiting to be claimed. Check the email or text from PayPal or Venmo to accept it.` :
    `Your ${amount} payout came back (${raw.toLowerCase()}). Check your payout address on your organizer page and tap Retry.`;
  await postDm(game.group_id, game.organizer_id, text, orgLink(game), { always: true });
}
