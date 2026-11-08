// Render Workflow tasks: the timed parts of a game, run on Render's task runners.
//
// A cron job calls `tick` every 10 minutes. `tick` finds what's due and fans out one
// task run per item, so each reminder, settlement and hold renewal retries on its own
// and shows up as its own run in the Render Dashboard.

import { task, type TaskContext } from "@renderinc/sdk/workflows";
import { one, q } from "@/lib/db";
import { type Game, type Spot, logEvent, whenLabel } from "@/lib/games";
import { reauthorize } from "@/lib/paypal";
import { nudgeUnfinished, postGroup, settleGame } from "@/bot/assistant";

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

const retry = { maxRetries: 3, waitDurationMs: 5_000, backoffScaling: 2 };

export const sendCancelByReminder = task(
  { name: "sendCancelByReminder", retry, timeoutSeconds: 60 },
  async function sendCancelByReminder(_ctx: TaskContext, gameId: string) {
    const claimed = await one<Game>(
      "update games set cancel_reminder_sent = true where id = $1 and not cancel_reminder_sent and status = 'open' returning *",
      [gameId],
    );
    if (!claimed) return { gameId, skipped: true };
    const nudged = await nudgeUnfinished(claimed);
    await logEvent(gameId, null, "cancel_by_reminder", { nudged });
    return { gameId, nudged };
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
    await postGroup(game.group_id, `Game in 2 hours: ${whenLabel(game.starts_at)} at ${game.place}. See you there!`, game.slug);
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
    const spot = await one<Spot>("select * from spots where id = $1 and hold_status = 'held'", [spotId]);
    if (!spot?.authorization_id || !spot.hold_cents) return { spotId, skipped: true };
    const renewed = await reauthorize(spot.authorization_id, spot.hold_cents);
    await q("update spots set authorization_id = $2, authorized_at = now(), updated_at = now() where id = $1", [
      spotId,
      renewed.id,
    ]);
    await logEvent(spot.game_id, spot.person_id, "hold_renewed", { from: spot.authorization_id, to: renewed.id });
    return { spotId, authorizationId: renewed.id };
  },
);

/** Entry point for the cron job: find what's due now and run each item as its own task. */
export const tick = task(
  { name: "tick", timeoutSeconds: 600 },
  async function tickRun(ctx: TaskContext) {
    const now = Date.now();
    const at = (ms: number) => new Date(now + ms);

    const [reminders, gameDay, toSettle, toRenew] = await Promise.all([
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
         where s.hold_status = 'held' and g.status = 'open' and g.starts_at > $1 and s.authorized_at <= $2`,
        [at(0), at(-REAUTHORIZE_AFTER)],
      ),
    ]);

    const results = await Promise.allSettled([
      ...reminders.map((g) => ctx.run(sendCancelByReminder, g.id)),
      ...gameDay.map((g) => ctx.run(sendGameDayReminder, g.id)),
      ...toSettle.map((g) => ctx.run(settleGameTask, g.id)),
      ...toRenew.map((s) => ctx.run(reauthorizeHold, s.id)),
    ]);

    return {
      reminders: reminders.length,
      gameDayReminders: gameDay.length,
      settled: toSettle.length,
      holdsRenewed: toRenew.length,
      failed: results.filter((r) => r.status === "rejected").length,
    };
  },
);
