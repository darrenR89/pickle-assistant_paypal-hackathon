// Demo-only shortcuts shared by the /play simulator and the phone demo: a simulated hold
// (no PayPal login), moving a game's clock, and running the scheduled jobs on demand.
// Same rules as the real paths; only the PayPal authorization is pretend (SIM- ids).

import { newToken, one, q } from "./db";
import { type Game, holdCents, inPlayers, isInvited, logEvent, roster, whenLabel } from "./games";
import { newSimulatedAuthorization } from "./paypal";
import { nudgeUnfinished, playerJoined, postGroup, settleGame, spotOfferFor } from "@/bot/assistant";
import { toHalfHour } from "@/bot/parse";

const HOUR = 3_600_000;

/** A hold placed without PayPal, so the demo can fill a game quickly. Same rules as a real join. */
export async function simulatedJoin(game: Game, personId: string) {
  const member = await one("select 1 from group_members where group_id = $1 and person_id = $2", [game.group_id, personId]);
  if (!member) return { error: "Not in this chat" };
  const entries = await roster(game.id);
  if (entries.some((e) => e.person_id === personId && e.status === "in")) return { error: "Already in" };
  const offered = await spotOfferFor(game.id, personId);
  if (!offered && !(await isInvited(game, personId))) return { error: "Invite-only: not on the list. Say \"I'm in\" to ask the organizer." };
  if (!offered && inPlayers(entries).length >= game.spots) return { error: "The game is full" };
  const amount = holdCents(game);
  await playerJoined(game, personId, newSimulatedAuthorization(), amount, `SIM-ORDER-${newToken().slice(0, 10)}`);
  return { ok: true };
}

/** What the scheduled job would do for this game right now, run on demand. */
export async function runDue(game: Game) {
  const now = Date.now();
  const ran: string[] = [];
  const cancelBy = new Date(game.cancel_by).getTime();
  const start = new Date(game.starts_at).getTime();
  if (!game.cancel_reminder_sent && cancelBy > now && cancelBy - now <= 3 * HOUR) {
    await q("update games set cancel_reminder_sent = true where id = $1", [game.id]);
    const n = await nudgeUnfinished(game);
    ran.push(`Free-cancel reminder (${n} nudged)`);
  }
  if (!game.gameday_reminder_sent && start > now && start - now <= 2 * HOUR) {
    await q("update games set gameday_reminder_sent = true where id = $1", [game.id]);
    await postGroup(game.group_id, `Game in 2 hours: ${whenLabel(game.starts_at)} at ${game.place}. See you there!`, game.slug);
    ran.push("Game-day reminder");
  }
  if (start <= now - 3 * HOUR) {
    await settleGame(game);
    ran.push("Settled the game");
  }
  return ran;
}

export type ClockMode = "before" | "gameday" | "soon" | "over";

/** Move the game in time: days out, game day (after free cancel), 90 minutes out, or finished. */
export async function moveClock(game: Game, mode: ClockMode) {
  const len = game.ends_at ? new Date(game.ends_at).getTime() - new Date(game.starts_at).getTime() : 2 * HOUR;
  const now = Date.now();
  const raw = mode === "before" ? now + 3 * 24 * HOUR : mode === "gameday" ? now + 5 * HOUR : mode === "soon" ? now + 90 * 60_000 : now - 4 * HOUR;
  const start = toHalfHour(new Date(raw), "floor").getTime();
  await q(
    `update games set starts_at = $2, ends_at = $3, cancel_by = $4,
       cancel_reminder_sent = $5, gameday_reminder_sent = $6 where id = $1`,
    [game.id, new Date(start), game.ends_at ? new Date(start + len) : null, new Date(start - 24 * HOUR), mode !== "before", mode === "over"],
  );
  await logEvent(game.id, null, "demo_clock", { mode });
  return { before: "3 days before the game", gameday: "game day, after free cancel", soon: "90 minutes before the game", over: "after the game" }[mode];
}
