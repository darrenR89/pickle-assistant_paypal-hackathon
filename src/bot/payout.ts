// Paying the organizer back: after a game settles (or is called off with the court fee charged),
// everything collected from the players goes to the organizer's Venmo or PayPal in one payout.
//
// Deterministic code only. The batch id is tied to the game, the address and a round number that
// only moves on when PayPal definitely refused or returned the money, so a retry never pays twice.

import { createHash } from "node:crypto";
import { one, q } from "@/lib/db";
import { type Game, logEvent, money, personById } from "@/lib/games";
import { PayPalError, type PayoutReceiver, createPayout, payoutReceiver } from "@/lib/paypal";
import { postDm } from "./assistant";

const MAX_ATTEMPTS = 3;

/** Where this organizer is paid: what they set on their page, else their phone number on Venmo. */
export function organizerPayoutTo(person: { phone: string; payout_to: string | null; payout_wallet: string | null }) {
  const wallet = person.payout_wallet === "PAYPAL" ? "PAYPAL" : "VENMO";
  return payoutReceiver(person.payout_to ?? person.phone, wallet);
}

export function describeReceiver(to: PayoutReceiver) {
  const where = to.wallet === "VENMO" ? "Venmo" : "PayPal";
  if (to.recipientType === "PHONE") return `${where} (phone ending ${to.receiver.slice(-4)})`;
  if (to.recipientType === "USER_HANDLE") return `Venmo @${to.receiver}`;
  return `${where} (${to.receiver})`;
}

/**
 * Send the organizer what was collected, once. Safe to call again: it only acts when no payout has
 * gone out yet or the last one failed. Never throws, so a payout problem can't undo a settle.
 */
export async function payOrganizer(gameId: string) {
  const game = await one<Game>(
    `update games set payout_status = 'sending', payout_attempts = payout_attempts + 1, payout_error = null
     where id = $1 and status in ('settled', 'cancelled') and (payout_status is null or payout_status = 'failed')
       and payout_attempts < $2
     returning *`,
    [gameId, MAX_ATTEMPTS],
  );
  if (!game) return;
  const organizerLink = `${game.slug}?o=${game.organizer_token}`;

  const spots = await q<{ captured_cents: number | null; refunded_cents: number; capture_id: string | null }>(
    "select captured_cents, refunded_cents, capture_id from spots where game_id = $1 and hold_status = 'captured' and person_id <> $2",
    [game.id, game.organizer_id],
  );
  const amount = spots.reduce((s, x) => s + (x.captured_cents ?? 0) - x.refunded_cents, 0);
  if (amount <= 0) {
    await q("update games set payout_status = 'none', payout_cents = 0 where id = $1", [game.id]);
    return;
  }

  const organizer = await personById(game.organizer_id);
  const to = organizer ? organizerPayoutTo(organizer) : null;
  if (!to) {
    await fail(game, "No payout address", amount);
    await postDm(game.group_id, game.organizer_id, `I couldn't send your ${money(amount)}: add a Venmo phone or PayPal email on your organizer page and I'll send it.`, organizerLink, { always: true });
    return;
  }

  // Simulated demo games (every charge a SIM- hold) get a simulated payout; anything real goes to PayPal.
  const simulated = spots.every((x) => !x.capture_id || x.capture_id.startsWith("SIM-"));
  const addressKey = createHash("sha256").update(`${to.wallet}:${to.recipientType}:${to.receiver}`).digest("hex").slice(0, 10);
  const batchId = `payout-${game.id}-${addressKey}-${game.payout_round}`;
  const when = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Los_Angeles" }).format(new Date(game.starts_at));
  try {
    const res = await createPayout({ batchId, amountCents: amount, to, note: `Court money from your pickleball game on ${when} at ${game.place}.`, simulated });
    const status = res.batch_header.batch_status === "SUCCESS" ? "sent" : "pending";
    await q("update games set payout_status = $2, payout_cents = $3, payout_batch_id = $4 where id = $1", [game.id, status, amount, res.batch_header.payout_batch_id]);
    await logEvent(game.id, game.organizer_id, "payout_sent", { cents: amount, batchId: res.batch_header.payout_batch_id, to: describeReceiver(to), simulated });
    await postDm(
      game.group_id,
      game.organizer_id,
      simulated
        ? `Paid you back: ${money(amount)} sent to your ${describeReceiver(to)}. (Demo game, so this payout is simulated.)`
        : `Paying you back: ${money(amount)} is on its way to your ${describeReceiver(to)}. I'll tell you when it lands.`,
      organizerLink,
      { always: true },
    );
  } catch (err) {
    const reason = err instanceof PayPalError ? payoutErrorReason(err) : "PayPal didn't respond";
    console.error("payout failed", game.id, err instanceof PayPalError ? JSON.stringify(err.details) : err);
    await fail(game, reason, amount);
    // A 4xx means PayPal refused it outright, so the next try can safely be a new batch.
    if (err instanceof PayPalError && err.status >= 400 && err.status < 500) await q("update games set payout_round = payout_round + 1 where id = $1", [game.id]);
    const final = game.payout_attempts >= MAX_ATTEMPTS;
    await postDm(
      game.group_id,
      game.organizer_id,
      `Your ${money(amount)} payout didn't go through (${reason}). ` + (final ? "Check your payout address on your organizer page and tap Retry." : "I'll try again shortly."),
      organizerLink,
      { always: true },
    );
  }
}

async function fail(game: Game, reason: string, amount: number) {
  await q("update games set payout_status = 'failed', payout_error = $2, payout_cents = $3 where id = $1", [game.id, reason, amount]);
  await logEvent(game.id, game.organizer_id, "payout_failed", { reason });
}

function payoutErrorReason(err: PayPalError) {
  const d = err.details as { name?: string; message?: string; details?: Array<{ issue?: string }> } | undefined;
  const issue = d?.details?.[0]?.issue ?? d?.name;
  if (issue === "INSUFFICIENT_FUNDS") return "the app's PayPal balance is too low";
  if (issue === "RECEIVER_UNREGISTERED" || issue === "RECEIVER_INVALID") return "that Venmo or PayPal account wasn't found";
  if (issue === "AUTHORIZATION_ERROR" || err.status === 403) return "Payouts isn't turned on for this PayPal app";
  return d?.message ?? `PayPal error ${err.status}`;
}

/** Organizer pressed Retry: give the payout a fresh set of attempts. */
export async function retryPayout(gameId: string) {
  await q("update games set payout_attempts = 0 where id = $1 and payout_status = 'failed'", [gameId]);
  await payOrganizer(gameId);
}
