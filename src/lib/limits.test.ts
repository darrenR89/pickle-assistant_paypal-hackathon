import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { holdBlocked, sanePriceCents, saneSpots, saneStart, termsProblem } from "@/lib/limits";

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
