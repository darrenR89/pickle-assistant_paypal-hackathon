import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { holdCents, money } from "@/lib/games";
import { payoutReceiver } from "@/lib/paypal";
import { describeReceiver, organizerPayoutTo } from "@/bot/payout";

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
