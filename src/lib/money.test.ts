import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { holdCents, money } from "@/lib/games";
import { payoutReceiver } from "@/lib/paypal";
import { describeReceiver, organizerPayoutTo } from "@/bot/payout";
import { shareFor, shortfall } from "@/bot/assistant";

describe("holdCents", () => {
  it("holds the share plus the short-roster cap", () => {
    assert.equal(holdCents({ share_cents: 800, cap_cents: 200 }), 1000);
  });
});

describe("money", () => {
  it("drops cents on whole dollars", () => {
    assert.equal(money(800), "$8");
    assert.equal(money(0), "$0");
  });
  it("shows two decimals otherwise", () => {
    assert.equal(money(850), "$8.50");
    assert.equal(money(1), "$0.01");
  });
});

describe("payoutReceiver", () => {
  it("sends an email to the chosen wallet", () => {
    assert.deepEqual(payoutReceiver(" alex@example.com ", "PAYPAL"), { receiver: "alex@example.com", recipientType: "EMAIL", wallet: "PAYPAL" });
  });
  it("sends an @handle to Venmo whatever wallet was picked", () => {
    assert.deepEqual(payoutReceiver("@alex_r", "PAYPAL"), { receiver: "alex_r", recipientType: "USER_HANDLE", wallet: "VENMO" });
  });
  it("normalizes a US phone number, with or without the leading 1", () => {
    assert.deepEqual(payoutReceiver("(415) 555-0134"), { receiver: "4155550134", recipientType: "PHONE", wallet: "VENMO" });
    assert.equal(payoutReceiver("+1 415 555 0134")?.receiver, "4155550134");
  });
  it("rejects anything else", () => {
    assert.equal(payoutReceiver("555-0134"), null);
    assert.equal(payoutReceiver("not an address"), null);
    assert.equal(payoutReceiver("@a"), null);
  });
});

describe("organizerPayoutTo", () => {
  it("falls back to the organizer's phone on Venmo", () => {
    assert.deepEqual(organizerPayoutTo({ phone: "+14155550134", payout_to: null, payout_wallet: null }), {
      receiver: "4155550134",
      recipientType: "PHONE",
      wallet: "VENMO",
    });
  });
  it("uses what the organizer set", () => {
    assert.equal(organizerPayoutTo({ phone: "+14155550134", payout_to: "a@b.co", payout_wallet: "PAYPAL" })?.wallet, "PAYPAL");
  });
});

describe("describeReceiver", () => {
  it("never shows a full phone number", () => {
    assert.equal(describeReceiver({ receiver: "4155550134", recipientType: "PHONE", wallet: "VENMO" }), "Venmo (phone ending 0134)");
  });
});

describe("shortfall (settle-up split)", () => {
  // $64 court, 8 spots: $8 share, $2 cap on top of each hold.
  const game = { total_cents: 6400, share_cents: 800, cap_cents: 200, spots: 8 };

  it("charges nothing extra when the game is full", () => {
    assert.deepEqual(shortfall(game, 8), { gap: 0, extraEach: 0 });
  });
  it("splits a short game's gap evenly, rounding down so players never pay more than an exact split", () => {
    assert.deepEqual(shortfall(game, 7), { gap: 800, extraEach: 114 }); // $8 / 7 = $1.142..., organizer absorbs the rest
  });
  it("charges the exact amount when the gap splits evenly", () => {
    assert.deepEqual(shortfall({ total_cents: 6000, share_cents: 1200, cap_cents: 500, spots: 5 }, 4), { gap: 1200, extraEach: 300 });
  });
  it("never charges more than the cap", () => {
    assert.deepEqual(shortfall(game, 4), { gap: 3200, extraEach: 200 });
  });
  it("leaves the rounding cents with the organizer, so a full game has no gap", () => {
    // $64 for 7 spots: $9.14 each, the organizer absorbs 2 cents.
    const odd = { total_cents: 6400, share_cents: shareFor(6400, 7), cap_cents: 200, spots: 7 };
    assert.deepEqual(shortfall(odd, 7), { gap: 0, extraEach: 0 });
    assert.deepEqual(shortfall(odd, 6), { gap: 914, extraEach: 152 });
  });
  it("keeps games created with a rounded-up share unchanged", () => {
    assert.deepEqual(shortfall({ total_cents: 6400, share_cents: 915, cap_cents: 200, spots: 7 }, 7), { gap: 0, extraEach: 0 });
    assert.deepEqual(shortfall({ total_cents: 6400, share_cents: 915, cap_cents: 200, spots: 7 }, 6), { gap: 910, extraEach: 151 });
  });
  it("handles nobody playing", () => {
    assert.deepEqual(shortfall(game, 0), { gap: 6400, extraEach: 0 });
  });
});

describe("shareFor", () => {
  it("splits the court evenly when it divides", () => assert.equal(shareFor(6400, 8), 800));
  it("rounds down so players never pay more than an exact split", () => assert.equal(shareFor(6400, 7), 914));
  it("is free for a free game or no spots", () => {
    assert.equal(shareFor(0, 8), 0);
    assert.equal(shareFor(6400, 0), 0);
  });
});
