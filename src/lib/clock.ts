// Where the demo clock puts a game. Moving the clock moves the game relative to now, so where it can the game keeps
// its time of day (a 6pm game stays 6pm) and only its date changes. "90 minutes to go" is the one stop that has to
// change the time, since the game must really start 90 minutes from now for the reminder to be due.

import { TZ } from "./games";
import { toHalfHour, zonedTime } from "@/bot/parse";

export type ClockMode = "week" | "before" | "gameday" | "soon" | "over";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const parts = (d: Date) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" })
      .formatToParts(d)
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;

/** The game's local time of day, on the local date closest to `target`. */
function sameTimeNear(start: Date, target: number) {
  const g = parts(start);
  const options = [-1, 0, 1].map((k) => {
    const a = parts(new Date(target + k * DAY));
    return zonedTime(a.year, a.month, a.day, g.hour, g.minute);
  });
  return options.reduce((best, c) => (Math.abs(c.getTime() - target) < Math.abs(best.getTime() - target) ? c : best));
}

/** The new start time for a clock stop. */
export function clockStart(mode: ClockMode, start: Date, now: number): Date {
  switch (mode) {
    case "week": // 6½ to 7½ days out: far enough for a delayed hold
      return sameTimeNear(start, now + 7 * DAY);
    case "before": // 2 to 3 days out: free cancel is open and a hold is placed right away
      return sameTimeNear(start, now + 60 * HOUR);
    case "gameday": {
      // Later today or tomorrow, inside the last 24 hours (free cancel over) but before the reminder is due.
      const c = sameTimeNear(start, now + 12 * HOUR);
      const ahead = c.getTime() - now;
      return ahead > 2 * HOUR && ahead < DAY ? c : toHalfHour(new Date(now + 5 * HOUR), "floor");
    }
    case "soon":
      return toHalfHour(new Date(now + 90 * 60_000), "floor");
    case "over": // 3 to 27 hours ago: due to settle
      return sameTimeNear(start, now - 15 * HOUR);
  }
}
