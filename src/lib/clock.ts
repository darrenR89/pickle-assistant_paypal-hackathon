// The simulator's clock. Moving it doesn't move the game: a 6pm game stays at 6pm and the simulated "now" moves
// instead, stored per demo game as an offset from the real clock (games.clock_offset_ms). Every rule that asks
// "what time is it?" for a game uses gameNow(game), so free cancel, reminders and settling all follow it.

export type ClockMode = "week" | "before" | "gameday" | "soon" | "over";

const HOUR = 3_600_000;

/** How long before the start (negative: after) each stop puts "now". */
const BEFORE_START: Record<ClockMode, number> = {
  week: 7 * 24 * HOUR, // far enough out for a delayed hold
  before: 60 * HOUR, // free cancel open, a hold is placed right away
  gameday: 5 * HOUR, // free cancel over, reminder not due yet
  soon: 90 * 60_000, // the game-day reminder is due
  over: -4 * HOUR, // due to settle
};

/** The clock offset (ms) that makes "now" land on this stop for a game starting at `start`. */
export function clockOffset(mode: ClockMode, start: Date, realNow: number) {
  return new Date(start).getTime() - BEFORE_START[mode] - realNow;
}
