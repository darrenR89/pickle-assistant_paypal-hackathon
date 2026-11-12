import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { delaysHold, repostsLink, fixDeadline, holdBlocked, holdDate, sanePriceCents, saneSpots, saneStart, termsProblem } from "@/lib/limits";

describe("saneSpots", () => {
  it("keeps a normal game size", () => {
    assert.equal(saneSpots(8), 8);
    assert.equal(saneSpots(2), 2);
    assert.equal(saneSpots(32), 32);
  });
  it("drops sizes we can't run, so the default applies", () => {
    for (const n of [0, 1, -4, 33, 1_000_000, Number.NaN, undefined]) assert.equal(saneSpots(n), undefined, String(n));
  });
});

describe("sanePriceCents", () => {
  it("keeps a normal price", () => assert.equal(sanePriceCents(6400), 6400));
  it("drops zero, negative and absurd prices, so the organizer is asked", () => {
    for (const n of [0, -100, 1_000_001, Number.POSITIVE_INFINITY, undefined]) assert.equal(sanePriceCents(n), undefined, String(n));
  });
});

describe("saneStart", () => {
  const now = new Date("2026-11-12T20:00:00Z");
  it("keeps a time that's still ahead", () => {
    const d = new Date("2026-11-13T02:00:00Z");
    assert.equal(saneStart(d, now), d);
  });
  it("moves a time earlier this week to next week", () => {
    assert.equal(saneStart(new Date("2026-11-12T02:00:00Z"), now)?.toISOString(), "2026-11-19T02:00:00.000Z");
  });
  it("drops a time further out than a PayPal hold lasts", () => {
    assert.equal(saneStart(new Date("2026-12-25T02:00:00Z"), now), undefined);
    assert.notEqual(saneStart(new Date("2026-12-09T02:00:00Z"), now), undefined);
  });
  it("drops anything older, a bad date, or nothing", () => {
    assert.equal(saneStart(new Date("2025-11-12T02:00:00Z"), now), undefined);
    assert.equal(saneStart(new Date("nope"), now), undefined);
    assert.equal(saneStart(undefined, now), undefined);
  });
});

describe("termsProblem", () => {
  it("accepts a normal edit", () => {
    assert.equal(termsProblem({ spots: 8, totalCents: 6400, capCents: 200 }, false), null);
    assert.equal(termsProblem({}, false), null);
  });
  it("rejects spot counts outside 2 to 32", () => {
    assert.match(termsProblem({ spots: 0 }, false) ?? "", /Spots/);
    assert.match(termsProblem({ spots: 500 }, false) ?? "", /Spots/);
  });
  it("needs a price on a posted game but not on a draft", () => {
    assert.match(termsProblem({ totalCents: 0 }, false) ?? "", /court cost/);
    assert.equal(termsProblem({ totalCents: 0 }, true), null);
  });
  it("rejects absurd amounts", () => {
    assert.match(termsProblem({ totalCents: 2_000_000_000 }, false) ?? "", /too high/);
    assert.match(termsProblem({ capCents: 50_000 }, true) ?? "", /too high/);
  });
});

describe("holdBlocked", () => {
  const game = { status: "open", spots: 8 };
  it("allows a hold while the game is open with room", () => assert.equal(holdBlocked(game, 7, false), null));
  it("blocks a hold once the game is full", () => assert.match(holdBlocked(game, 8, false) ?? "", /filled up/));
  it("lets someone who was handed a spot join a full game", () => assert.equal(holdBlocked(game, 8, true), null));
  it("blocks a hold on a game that settled or was called off, even if a spot was offered", () => {
    for (const status of ["settling", "settled", "cancelling", "cancelled", "draft"]) {
      assert.match(holdBlocked({ status, spots: 8 }, 3, true) ?? "", /closed/, status);
    }
  });
});

describe("delayed holds", () => {
  const now = new Date("2026-11-10T18:00:00Z");
  const inDays = (d: number, h = 0) => new Date(now.getTime() + d * 86400_000 + h * 3600_000);
  it("holds right away for a game within 3 days, which is most games", () => {
    assert.equal(delaysHold(inDays(1), now, true), false);
    assert.equal(delaysHold(inDays(3), now, true), false);
  });
  it("saves the payment method instead when the game is further out", () => {
    assert.equal(delaysHold(inDays(3, 1), now, true), true);
    assert.equal(delaysHold(inDays(20), now, true), true);
  });
  it("never delays while the feature is switched off", () => assert.equal(delaysHold(inDays(20), now, false), false));
  it("places the hold two days before the start, so charging 3 hours after start is inside PayPal's 3 days", () => {
    const start = inDays(10);
    assert.equal(holdDate(start).getTime(), inDays(8).getTime());
    assert.ok(start.getTime() + 3 * 3600_000 - holdDate(start).getTime() < 3 * 86400_000);
  });
  it("gives a day to fix a refused hold", () => {
    assert.equal(fixDeadline(inDays(0), inDays(2)).getTime(), inDays(1).getTime());
  });
  it("but never lets the fix window run into the last 3 hours before the game", () => {
    assert.equal(fixDeadline(inDays(0), inDays(0, 10)).getTime(), inDays(0, 7).getTime());
  });
});

describe("repostsLink", () => {
  it("reposts the link at the fourth and eighth player while spots are left", () => {
    assert.equal(repostsLink(4, 8), true);
    assert.equal(repostsLink(8, 12), true);
  });
  it("stays quiet otherwise, and once the game is full", () => {
    for (const n of [0, 1, 3, 5, 7]) assert.equal(repostsLink(n, 8), false, String(n));
    assert.equal(repostsLink(8, 8), false);
    assert.equal(repostsLink(4, 4), false);
  });
});
