// Render Workflow tasks: the timed parts of a game, run on Render's task runners.
//
// A cron job calls `tick` every 10 minutes. `tick` finds what's due and fans out one
// task run per item, so each reminder, settlement and hold renewal retries on its own
// and shows up as its own run in the Render Dashboard.

import { task, type TaskContext } from "@renderinc/sdk/workflows";
import { one, q } from "@/lib/db";
import { type Game, type Spot, gameDayLine, logEvent } from "@/lib/games";
import { isTerminalPayPalError, reauthorize } from "@/lib/paypal";
import { cancelGame, nudgeUnfinished, postGroup, settleGame } from "@/bot/assistant";
import { payOrganizer } from "@/bot/payout";

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Send the "not on the list yet" reminder in the 3 hours before free cancel ends. */
const CANCEL_REMINDER_WINDOW = 3 * HOUR;
/** Post a game-day reminder 2 hours before start. */
const GAMEDAY_REMINDER_LEAD = 2 * HOUR;
/** Settle 3 hours after start: 2 hours of play, then time for game-time decisions. */
const SETTLE_AFTER = 3 * HOUR;
/** PayPal honors a hold for 3 days; renew it after that, while the game is still ahead. */
const REAUTHORIZE_AFTER = 3 * 24 * HOUR + 30 * MIN;
/** A settle, call-off or payout still mid-way after this long was cut off (a restart), so finish it. */
const STUCK_AFTER = 10 * MIN;

const retry = { maxRetries: 3, waitDurationMs: 5_000, backoffScaling: 2 };

export const sendCancelByReminder = task(
  { name: "sendCancelByReminder", retry, timeoutSeconds: 60 },
  async function sendCancelByReminder(_ctx: TaskContext, gameId: string) {
    const claimed = await one<Game>(
      "update games set cancel_reminder_sent = true where id = $1 and not cancel_reminder_sent and status = 'open' returning *",
      [gameId],
    );
    if (!claimed) return { gameId, skipped: true };
    try {
      const nudged = await nudgeUnfinished(claimed);
      await logEvent(gameId, null, "cancel_by_reminder", { nudged });
      return { gameId, nudged };
    } catch (err) {
      // Not sent, so give the claim back and let the retry send it.
      await q("update games set cancel_reminder_sent = false where id = $1", [gameId]);
      throw err;
    }
  },
);

export const sendGameDayReminder = task(
  { name: "sendGameDayReminder", retry, timeoutSeconds: 60 },
  async function sendGameDayReminder(_ctx: TaskContext, gameId: string) {
    const game = await one<Game>(
      "update games set gameday_reminder_sent = true where id = $1 and not gameday_reminder_sent and status = 'open' returning *",
      [gameId],
    );
    if (!game) return { gameId, skipped: true };
    try {
      await postGroup(game.group_id, gameDayLine(game), game.slug);
    } catch (err) {
      await q("update games set gameday_reminder_sent = false where id = $1", [gameId]);
      throw err;
    }
    return { gameId, posted: true };
  },
);

export const settleGameTask = task(
  { name: "settleGame", retry, timeoutSeconds: 300 },
  async function settleGameRun(_ctx: TaskContext, gameId: string) {
    const game = await one<Game>("select * from games where id = $1", [gameId]);
    if (!game || game.status !== "open") return { gameId, skipped: true };
    await settleGame(game);
    return { gameId, settled: true };
  },
);

export const reauthorizeHold = task(
  { name: "reauthorizeHold", retry, timeoutSeconds: 60 },
  async function reauthorizeHoldRun(_ctx: TaskContext, spotId: string) {
    const spot = await one<Spot>("select * from spots where id = $1 and hold_status = 'held' and not reauthorized", [spotId]);
    if (!spot?.authorization_id || !spot.hold_cents) return { spotId, skipped: true };
    let renewed: Awaited<ReturnType<typeof reauthorize>>;
    try {
      renewed = await reauthorize(spot.authorization_id, spot.hold_cents);
    } catch (err) {
      if (!isTerminalPayPalError(err)) throw err;
      // PayPal won't renew this hold. Don't ask again every 10 minutes; the original hold stays in place.
      await q("update spots set reauthorized = true where id = $1", [spotId]);
      await logEvent(spot.game_id, spot.person_id, "hold_renew_refused", { authorizationId: spot.authorization_id });
      return { spotId, refused: true };
    }
    // PayPal allows one renewal per hold, so this spot is never queued again.
    await q("update spots set authorization_id = $2, authorized_at = now(), reauthorized = true, updated_at = now() where id = $1", [
      spotId,
      renewed.id,
    ]);
    await logEvent(spot.game_id, spot.person_id, "hold_renewed", { from: spot.authorization_id, to: renewed.id });
    return { spotId, authorizationId: renewed.id };
  },
);

export const payOrganizerTask = task(
  { name: "payOrganizer", retry, timeoutSeconds: 120 },
  async function payOrganizerRun(_ctx: TaskContext, gameId: string) {
    await payOrganizer(gameId);
    const g = await one<Game>("select * from games where id = $1", [gameId]);
    return { gameId, payout: g?.payout_status, cents: g?.payout_cents };
  },
);

/**
 * A game left in `settling` or `cancelling` by a restart. Reopen it and finish with the choice it
 * started with. Safe to repeat: each player's capture or release is recorded as it happens.
 */
export const recoverGame = task(
  { name: "recoverGame", retry, timeoutSeconds: 300 },
  async function recoverGameRun(_ctx: TaskContext, gameId: string) {
    const game = await one<Game & { was: string }>(
      `with old as (select status from games where id = $1 for update)
       update games set status = 'open', status_changed_at = now()
       where id = $1 and status in ('settling', 'cancelling') and (status_changed_at is null or status_changed_at < $2)
       returning games.*, (select status from old) as was`,
      [gameId, new Date(Date.now() - STUCK_AFTER)],
    );
    if (!game) return { gameId, skipped: true };
    await logEvent(gameId, null, "recovered", { was: game.was, choice: game.closing_choice });
    if (game.was === "cancelling") await cancelGame(game, { charge: game.closing_choice === "charge" });
    else await settleGame(game, { gap: game.closing_choice === "cover" ? "cover" : "split" });
    return { gameId, recovered: game.was };
  },
);

/** Entry point for the cron job: find what's due now and run each item as its own task. */
export const tick = task(
  { name: "tick", timeoutSeconds: 600 },
  async function tickRun(ctx: TaskContext) {
    const now = Date.now();
    const at = (ms: number) => new Date(now + ms);

    // A payout cut off mid-send goes back to failed, so the retry below picks it up. The batch id
    // is unchanged, so if PayPal did get the first one, the retry can't pay twice.
    await q(
      `update games set payout_status = 'failed', payout_error = 'It was interrupted'
       where payout_status = 'sending' and (payout_started_at is null or payout_started_at < $1)`,
      [at(-STUCK_AFTER)],
    );

    const [reminders, gameDay, toSettle, toRenew, toPay, stuck] = await Promise.all([
      q<{ id: string }>(
        "select id from games where status = 'open' and not cancel_reminder_sent and cancel_by > $1 and cancel_by <= $2",
        [at(0), at(CANCEL_REMINDER_WINDOW)],
      ),
      q<{ id: string }>(
        "select id from games where status = 'open' and not gameday_reminder_sent and starts_at > $1 and starts_at <= $2",
        [at(0), at(GAMEDAY_REMINDER_LEAD)],
      ),
      q<{ id: string }>("select id from games where status = 'open' and starts_at <= $1", [at(-SETTLE_AFTER)]),
      q<{ id: string }>(
        `select s.id from spots s join games g on g.id = s.game_id
         where s.hold_status = 'held' and not s.reauthorized and g.status = 'open' and g.starts_at > $1 and s.authorized_at <= $2`,
        [at(0), at(-REAUTHORIZE_AFTER)],
      ),
      // Payouts that failed for a reason worth retrying (payOrganizer stops after 3 attempts).
      q<{ id: string }>("select id from games where status in ('settled', 'cancelled') and payout_status = 'failed' and payout_attempts < 3"),
      q<{ id: string }>(
        "select id from games where status in ('settling', 'cancelling') and (status_changed_at is null or status_changed_at < $1)",
        [at(-STUCK_AFTER)],
      ),
    ]);

    const results = await Promise.allSettled([
      ...reminders.map((g) => ctx.run(sendCancelByReminder, g.id)),
      ...gameDay.map((g) => ctx.run(sendGameDayReminder, g.id)),
      ...toSettle.map((g) => ctx.run(settleGameTask, g.id)),
      ...toRenew.map((s) => ctx.run(reauthorizeHold, s.id)),
      ...toPay.map((g) => ctx.run(payOrganizerTask, g.id)),
      ...stuck.map((g) => ctx.run(recoverGame, g.id)),
    ]);

    const summary = {
      reminders: reminders.length,
      gameDayReminders: gameDay.length,
      settled: toSettle.length,
      holdsRenewed: toRenew.length,
      payoutsRetried: toPay.length,
      recovered: stuck.length,
      failed: results.filter((r) => r.status === "rejected").length,
    };
    console.log(`tick ${JSON.stringify(summary)}`);
    for (const r of results) if (r.status === "rejected") console.error("tick item failed:", r.reason);
    return summary;
  },
);
