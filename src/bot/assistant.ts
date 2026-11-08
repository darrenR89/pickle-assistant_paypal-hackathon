// The assistant's group-chat behavior. Channel-agnostic: the web playground calls
// handleGroupMessage today; a Chat SDK adapter (Blooio, etc.) can call it later.
//
// Rule: the AI only reads intent (parsing a new game). Every money movement below
// is deterministic code.

import { newId, newToken, q } from "@/lib/db";
import {
  type Game,
  type RosterEntry,
  gameUrl,
  getGame,
  holdCents,
  inPlayers,
  isBeforeCancelBy,
  logEvent,
  money,
  openGameForGroup,
  personById,
  roster,
  shortWhen,
  whenLabel,
} from "@/lib/games";
import { captureAuthorization, voidAuthorization } from "@/lib/paypal";
import { parseGameRequest } from "./parse";

const DEFAULT_CAP_CENTS = 200;
const CANCEL_BY_HOURS = 24;

// ---------- posting ----------

export async function postGroup(groupId: string, text: string, gameSlug?: string) {
  await q("insert into messages (group_id, sender_id, text, game_slug) values ($1, null, $2, $3)", [
    groupId,
    text,
    gameSlug ?? null,
  ]);
}

/** A private 1:1 message. In the playground it shows in that person's inbox. */
export async function postDm(groupId: string, personId: string, text: string, gameSlug?: string) {
  await q("insert into messages (group_id, sender_id, dm_to, text, game_slug) values ($1, null, $2, $3, $4)", [
    groupId,
    personId,
    text,
    gameSlug ?? null,
  ]);
}

// ---------- intent matching ----------

const NO_GAME_HINT = "There's no game set up yet.";
const MENTION = /@(assistant|pickle\w*|bot)\b/i;
const SAYS_IN = /^\s*(i'?m\s+in|in|me|me too|count me in|\+1|i can play|i'?ll play|yes|yep)\b[\s!.]*$/i;
const SAYS_OUT = /^\s*(i'?m\s+out|out|can'?t make it|i can'?t (play|make it)|drop me|count me out)\b/i;

export async function handleGroupMessage(groupId: string, senderId: string, text: string) {
  await q("insert into messages (group_id, sender_id, text) values ($1, $2, $3)", [groupId, senderId, text]);

  const open = await openGameForGroup(groupId);

  if (MENTION.test(text)) {
    if (open && !/\b(new game|another game)\b/i.test(text) && !/\$|\d+\s*spots/i.test(text)) {
      await postGroup(groupId, `${(await rosterLine(open))} Tap to play:`, open.slug);
      return;
    }
    await createGame(groupId, senderId, text);
    return;
  }

  if (!open) {
    // "in" before any game exists: explain once how to start one, then stay quiet.
    if (SAYS_IN.test(text)) {
      const last = await q<{ text: string }>(
        "select text from messages where group_id = $1 and sender_id is null and dm_to is null order by id desc limit 1",
        [groupId],
      );
      if (!last[0]?.text.startsWith(NO_GAME_HINT)) {
        await postGroup(groupId, `${NO_GAME_HINT} Anyone can start one, like: "@Assistant Thu 6pm Riverside courts 3–4, 8 spots, $64"`);
      }
    }
    return;
  }
  if (SAYS_IN.test(text)) return saidIn(open, senderId);
  if (SAYS_OUT.test(text)) return playerOut(open, senderId);
}

// ---------- creating a game ----------

async function createGame(groupId: string, organizerId: string, text: string) {
  const organizer = await personById(organizerId);
  const parsed = await parseGameRequest(text);
  const missing = new Set(parsed.missing);
  if (!parsed.startsAt) missing.add("starts_at");
  if (!parsed.spots) missing.add("spots");
  if (!parsed.priceCents) missing.add("price");
  if (!parsed.place) missing.add("place");

  if (missing.size) {
    const words: Record<string, string> = {
      starts_at: "when",
      place: "where",
      spots: "how many spots",
      price: "the court cost",
    };
    const ask = [...missing].map((m) => words[m] ?? m);
    await postGroup(
      groupId,
      `${organizer?.name ?? "Hey"}, I can set that up. I just need ${listWords(ask)}. ` +
        `For example: "@Assistant Thu 6pm Riverside courts 3–4, 8 spots, $64"`,
    );
    return;
  }

  const spots = parsed.spots!;
  const startsAt = parsed.startsAt!;
  const total = parsed.priceIsTotal ? parsed.priceCents! : parsed.priceCents! * spots;
  const share = Math.ceil(total / spots);
  const cancelBy = new Date(startsAt.getTime() - CANCEL_BY_HOURS * 3600_000);
  const slug = `${shortWhen(startsAt).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${newToken().slice(0, 5)}`;
  const gameId = newId("game");
  const organizerToken = newToken();

  await q(
    `insert into games (id, slug, group_id, organizer_id, starts_at, place, spots, total_cents, share_cents,
       cap_cents, cancel_by, organizer_token)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [gameId, slug, groupId, organizerId, startsAt, parsed.place, spots, total, share, DEFAULT_CAP_CENTS, cancelBy, organizerToken],
  );
  // The organizer is automatically in. They paid the court, so they don't need a hold.
  await q(
    "insert into spots (id, game_id, person_id, status, hold_status) values ($1, $2, $3, 'in', 'none')",
    [newId("spot"), gameId, organizerId],
  );
  await logEvent(gameId, organizerId, "created", { text });

  const game = (await getGame(slug))!;
  await postGroup(
    groupId,
    `${whenLabel(startsAt)} · ${game.place} · ${spots} spots · ${money(share)} each, free cancel until ${whenLabel(cancelBy)}. Tap to play:`,
    slug,
  );
  await postDm(
    groupId,
    organizerId,
    `Your game is up. I used the usual terms: free cancel until 24 hours before, and up to ${money(DEFAULT_CAP_CENTS)} extra each if the game is short. Change them here (only you can see this link):`,
    `${slug}?o=${organizerToken}`,
  );
}

// ---------- joining ----------

async function saidIn(game: Game, personId: string) {
  const entries = await roster(game.id);
  const mine = entries.find((e) => e.person_id === personId);
  const person = await personById(personId);
  if (mine?.status === "in") {
    await postGroup(game.group_id, `${person?.name}, you're already in.`);
    return;
  }
  if (inPlayers(entries).length >= game.spots) {
    await postGroup(game.group_id, `Sorry ${person?.name}, the game is full.`);
    return;
  }
  await q(
    "insert into intents (game_id, person_id) values ($1, $2) on conflict (game_id, person_id) do nothing",
    [game.id, personId],
  );
  await postGroup(game.group_id, `${person?.name}, tap to confirm you're in:`, game.slug);
}

/** Called once a player's hold is approved. */
export async function playerJoined(game: Game, personId: string, authorizationId: string, holdCentsValue: number, orderId: string) {
  await q(
    `insert into spots (id, game_id, person_id, status, order_id, authorization_id, hold_cents, hold_status, authorized_at)
     values ($1, $2, $3, 'in', $4, $5, $6, 'held', now())
     on conflict (game_id, person_id) do update set status = 'in', order_id = $4, authorization_id = $5,
       hold_cents = $6, hold_status = 'held', late_cancel = null, authorized_at = now(), updated_at = now()`,
    [newId("spot"), game.id, personId, orderId, authorizationId, holdCentsValue],
  );
  await q("delete from intents where game_id = $1 and person_id = $2", [game.id, personId]);
  await logEvent(game.id, personId, "joined", { authorizationId, holdCents: holdCentsValue });

  await postGroup(game.group_id, await rosterLine(game));
  await postDm(
    game.group_id,
    personId,
    `You're in for ${whenLabel(game.starts_at)}. ${money(holdCentsValue)} is on hold; your share is ${money(game.share_cents)}. ` +
      `Nothing is charged until after the game, and cancelling before ${whenLabel(game.cancel_by)} releases it.`,
    game.slug,
  );
}

// ---------- leaving ----------

export async function playerOut(game: Game, personId: string) {
  const entries = await roster(game.id);
  const mine = entries.find((e) => e.person_id === personId);
  const person = await personById(personId);
  await q("delete from intents where game_id = $1 and person_id = $2", [game.id, personId]);
  if (!mine || mine.status !== "in") return;

  if (personId === game.organizer_id) {
    await postGroup(game.group_id, `${person?.name}, you're the organizer. To call off the game, use your organizer link.`);
    return;
  }

  if (isBeforeCancelBy(game) || mine.hold_status !== "held") {
    if (mine.authorization_id && mine.hold_status === "held") {
      await voidAuthorization(mine.authorization_id);
    }
    await q("update spots set status = 'out', hold_status = case when hold_status = 'held' then 'voided' else hold_status end, updated_at = now() where id = $1", [mine.id]);
    await logEvent(game.id, personId, "out", { late: false });
    await postGroup(game.group_id, `${person?.name} is out. ${await rosterLine(game)}`);
    if (mine.hold_status === "held") {
      await postDm(game.group_id, personId, `You're out of ${whenLabel(game.starts_at)}. Your ${money(mine.hold_cents ?? 0)} hold is released.`);
    }
    return;
  }

  // Late cancel: keep the hold; the organizer decides.
  await q("update spots set status = 'out', late_cancel = 'pending', updated_at = now() where id = $1", [mine.id]);
  await logEvent(game.id, personId, "out", { late: true });
  await postGroup(game.group_id, `${person?.name} is out. ${await rosterLine(game)}`);
  await postDm(
    game.group_id,
    personId,
    `You're out of ${whenLabel(game.starts_at)}. It's past the free-cancel time, so the organizer will decide whether your ${money(game.share_cents)} share is charged.`,
  );
  await postDm(
    game.group_id,
    game.organizer_id,
    `${person?.name} cancelled after the free-cancel time. Charge their ${money(game.share_cents)} share or cover it?`,
    `${game.slug}?o=${game.organizer_token}`,
  );
}

export async function resolveLateCancel(game: Game, spotId: string, decision: "charge" | "cover") {
  const entries = await roster(game.id);
  const spot = entries.find((e) => e.id === spotId && e.late_cancel === "pending");
  if (!spot || !spot.authorization_id) return;
  if (decision === "charge") {
    await captureAuthorization(spot.authorization_id, game.share_cents);
    await q("update spots set late_cancel = 'charged', hold_status = 'captured', captured_cents = $2, updated_at = now() where id = $1", [spot.id, game.share_cents]);
    await postDm(game.group_id, spot.person_id, `Your ${money(game.share_cents)} share for ${whenLabel(game.starts_at)} was charged for the late cancel.`);
  } else {
    await voidAuthorization(spot.authorization_id);
    await q("update spots set late_cancel = 'covered', hold_status = 'voided', updated_at = now() where id = $1", [spot.id]);
    await postDm(game.group_id, spot.person_id, `Good news: the organizer covered your late cancel. Your hold is released.`);
  }
  await logEvent(game.id, spot.person_id, `late_cancel_${decision}`);
}

// ---------- reminders ----------

export async function nudgeUnfinished(game: Game) {
  const rows = await q<{ person_id: string; name: string }>(
    `select i.person_id, p.name from intents i join people p on p.id = i.person_id
     where i.game_id = $1 and not i.nudged`,
    [game.id],
  );
  if (!rows.length) return 0;
  for (const r of rows) {
    await postGroup(game.group_id, `${r.name}, you're not on the list yet. Tap to confirm:`, game.slug);
  }
  await q("update intents set nudged = true where game_id = $1", [game.id]);
  return rows.length;
}

// ---------- terms ----------

export type TermsChange = { cancelBy?: Date; capCents?: number; totalCents?: number; spots?: number };

export async function updateTerms(game: Game, change: TermsChange) {
  const entries = await roster(game.id);
  const playersHolding = entries.some((e) => e.hold_status === "held");
  const next = {
    cancelBy: change.cancelBy ?? new Date(game.cancel_by),
    capCents: change.capCents ?? game.cap_cents,
    totalCents: change.totalCents ?? game.total_cents,
    spots: change.spots ?? game.spots,
  };
  if (playersHolding) {
    // Once anyone is in, terms can only move in players' favor.
    if (next.cancelBy < new Date(game.cancel_by)) throw new Error("Free cancel can only move later once players are in.");
    if (next.capCents > game.cap_cents) throw new Error("The cap can only go down once players are in.");
    if (next.totalCents > game.total_cents) throw new Error("The price can only go down once players are in.");
    if (next.spots < inPlayers(entries).length) throw new Error("There are already more players in than that.");
  }
  const share = Math.ceil(next.totalCents / next.spots);
  if (playersHolding && share > game.share_cents) throw new Error("That would raise each share. Add spots only if the price drops too.");
  await q(
    "update games set cancel_by = $2, cap_cents = $3, total_cents = $4, spots = $5, share_cents = $6 where id = $1",
    [game.id, next.cancelBy, next.capCents, next.totalCents, next.spots, share],
  );
  await logEvent(game.id, game.organizer_id, "terms_changed", change);

  const parts: string[] = [];
  if (change.cancelBy && +change.cancelBy !== +new Date(game.cancel_by)) parts.push(`free cancel is now until ${whenLabel(next.cancelBy)}`);
  if (share !== game.share_cents) parts.push(`it's now ${money(share)} each`);
  if (next.spots !== game.spots) parts.push(`${next.spots} spots`);
  if (next.capCents !== game.cap_cents) parts.push(`short-game extra is now up to ${money(next.capCents)}`);
  if (parts.length) await postGroup(game.group_id, `Update: ${parts.join(", ")}.`, game.slug);
}

// ---------- settling ----------

/**
 * After the game: charge each player their share, plus an even part of any gap if the
 * game ran short (never more than the cap). The organizer absorbs what's left.
 */
export async function settleGame(game: Game) {
  // Claim the game so a scheduled run and the organizer's button can't both settle it.
  const claimed = await q("update games set status = 'settling' where id = $1 and status = 'open' returning id", [game.id]);
  if (!claimed.length) return;
  try {
    await settleClaimed(game);
  } catch (err) {
    // Captures already done are recorded per player; a retry continues with the rest.
    await q("update games set status = 'open' where id = $1 and status = 'settling'", [game.id]);
    throw err;
  }
}

async function settleClaimed(game: Game) {
  const entries = await roster(game.id);
  const playing = inPlayers(entries);
  const payers = playing.filter((e) => e.person_id !== game.organizer_id && e.hold_status === "held");
  const sharesCovered = playing.length * game.share_cents;
  const gap = Math.max(0, game.total_cents - sharesCovered);
  const extraEach = playing.length ? Math.min(game.cap_cents, Math.ceil(gap / playing.length)) : 0;

  let collected = 0;
  for (const p of payers) {
    const amount = Math.min(game.share_cents + extraEach, p.hold_cents ?? 0);
    await captureAuthorization(p.authorization_id!, amount);
    await q("update spots set hold_status = 'captured', captured_cents = $2, updated_at = now() where id = $1", [p.id, amount]);
    collected += amount;
    await postDm(
      game.group_id,
      p.person_id,
      `Thanks for playing! ${money(amount)} was charged for ${whenLabel(game.starts_at)}` +
        (extraEach ? ` (your ${money(game.share_cents)} share plus ${money(extraEach)} because the game was short).` : "."),
    );
  }
  // Late cancels nobody decided on are covered by default.
  for (const e of entries.filter((x) => x.late_cancel === "pending" && x.authorization_id)) {
    await voidAuthorization(e.authorization_id!);
    await q("update spots set late_cancel = 'covered', hold_status = 'voided' where id = $1", [e.id]);
  }
  const alreadyCaptured = entries
    .filter((e) => e.hold_status === "captured" && !payers.some((p) => p.id === e.id))
    .reduce((s, e) => s + (e.captured_cents ?? 0), 0);
  collected += alreadyCaptured;

  await q("update games set status = 'settled' where id = $1", [game.id]);
  await logEvent(game.id, null, "settled", { collected, extraEach });
  await postGroup(game.group_id, `Good game! ${playing.length} played ${whenLabel(game.starts_at).split(" ")[0]}.`);
  const covered = entries.filter((e) => e.late_cancel === "covered" || e.late_cancel === "pending").map((e) => e.name);
  await postDm(
    game.group_id,
    game.organizer_id,
    `${money(collected)} collected of ${money(game.total_cents)}. ${playing.length} played` +
      (covered.length ? `; you covered ${listWords(covered)}.` : ".") +
      ` Payout to your PayPal or Venmo comes next in the build.`,
    `${game.slug}?o=${game.organizer_token}`,
  );
}

export async function cancelGame(game: Game) {
  if (game.status !== "open") return;
  const entries = await roster(game.id);
  for (const e of entries.filter((x) => x.hold_status === "held" && x.authorization_id)) {
    await voidAuthorization(e.authorization_id!);
    await q("update spots set hold_status = 'voided' where id = $1", [e.id]);
    if (e.person_id !== game.organizer_id) {
      await postDm(game.group_id, e.person_id, `${whenLabel(game.starts_at)} is cancelled. Your hold is released.`);
    }
  }
  await q("update games set status = 'cancelled' where id = $1", [game.id]);
  await logEvent(game.id, game.organizer_id, "cancelled");
  await postGroup(game.group_id, `${whenLabel(game.starts_at)} at ${game.place} is cancelled. All holds are released.`);
}

// ---------- helpers ----------

export async function rosterLine(game: Game) {
  const playing = inPlayers(await roster(game.id));
  const names = playing.map((p) => p.name).join(", ");
  const left = game.spots - playing.length;
  return `${playing.length} of ${game.spots} in: ${names}. ${left > 0 ? `${left} spot${left === 1 ? "" : "s"} left.` : "Game's full!"}`;
}

function listWords(words: string[]) {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

export { holdCents, gameUrl };
export type { RosterEntry };
