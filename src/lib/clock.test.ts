import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clockOffset } from "@/lib/clock";
import { cancelRule, gameDayLine, gameNow } from "@/lib/games";

const HOUR = 3_600_000;
// Thursday 6pm game with free cancel until Wednesday 6pm, tested at 5:51am Thursday (Pacific).
const start = new Date("2026-11-13T02:00:00Z");
const cancelBy = new Date(start.getTime() - 24 * HOUR);
const realNow = new Date("2026-11-12T13:51:00Z").getTime();

describe("the simulator's clock", () => {
  it("moves now, not the game", () => {
    const off = clockOffset("soon", start, realNow);
    const now = realNow + off;
    assert.equal((start.getTime() - now) / 60_000, 90);
  });
  it("puts each stop where its rules apply", () => {
    const ahead = (mode: "week" | "before" | "gameday" | "soon" | "over") => (start.getTime() - (realNow + clockOffset(mode, start, realNow))) / HOUR;
    assert.ok(ahead("week") > 3 * 24, "week: far enough for a delayed hold");
    assert.ok(ahead("before") > 48 && ahead("before") < 72, "before: free cancel open");
    assert.ok(ahead("gameday") > 2 && ahead("gameday") < 24, "game day: free cancel over, reminder not due");
    assert.ok(ahead("soon") > 0 && ahead("soon") <= 2, "soon: reminder due");
    assert.ok(ahead("over") <= -3, "over: due to settle");
  });
  it("is what the game's rules read as now", () => {
    const at = (mode: "before" | "soon") => ({ starts_at: start, cancel_by: cancelBy, place: "Riverside Park", clock_offset_ms: String(clockOffset(mode, start, Date.now())) });
    assert.match(cancelRule(at("before")), /^free cancel until/);
    assert.equal(cancelRule(at("soon")), "free cancel has ended");
    assert.match(gameDayLine(at("soon")), /^Game in about an hour: Thu 6:00pm/);
    assert.ok(Math.abs(gameNow({ clock_offset_ms: 0 }).getTime() - Date.now()) < 1000);
  });
});
