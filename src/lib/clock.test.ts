import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clockStart } from "@/lib/clock";

const HOUR = 3_600_000;
const la = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" }).format(d);

// Thursday 6pm game, tested at 5:51am the same day (Pacific).
const start = new Date("2026-11-13T02:00:00Z");
const now = new Date("2026-11-12T13:51:00Z").getTime();

describe("clockStart", () => {
  it("keeps the game's time of day for a week out, days out, game day and after", () => {
    for (const mode of ["week", "before", "gameday", "over"] as const) assert.equal(la(clockStart(mode, start, now)), "6:00 PM", mode);
  });
  it("puts each stop where its rules apply", () => {
    const ahead = (mode: "week" | "before" | "gameday" | "soon" | "over") => (clockStart(mode, start, now).getTime() - now) / HOUR;
    assert.ok(ahead("week") > 3 * 24, "week: far enough for a delayed hold");
    assert.ok(ahead("before") > 48 && ahead("before") <= 72, "before: free cancel open, hold placed now");
    assert.ok(ahead("gameday") > 2 && ahead("gameday") < 24, "game day: free cancel over, reminder not due");
    assert.ok(ahead("soon") > 1 && ahead("soon") <= 1.5, "soon: reminder due");
    assert.ok(ahead("over") <= -3, "over: due to settle");
  });
  it("falls back to 5 hours out on game day when the game's time is too close", () => {
    const late = new Date("2026-11-13T00:30:00Z").getTime(); // 4:30pm, game at 6pm
    const h = (clockStart("gameday", start, late).getTime() - late) / HOUR;
    assert.ok(h > 2 && h < 24, String(h));
  });
});
