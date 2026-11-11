import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cancelRule, gameDayLine, holdCents, money, payoutUnderway } from "@/lib/games";
import { PayPalError, capturedCents, isTerminalPayPalError, payoutReceiver, verifyBody } from "@/lib/paypal";
import { describeReceiver, organizerPayoutTo } from "@/bot/payout";
import { chargedLateCancels, shareFor, shortfall } from "@/bot/assistant";

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

describe("shortfall with a charged late cancel", () => {
  const game = { total_cents: 6400, share_cents: 800, cap_cents: 200, spots: 8 };

  it("doesn't bill the players for an empty spot the late canceller already paid for", () => {
    // 7 play, 1 cancelled late and was charged $8: every share is paid, so nobody owes extra.
    assert.deepEqual(shortfall(game, 7, 1), { gap: 0, extraEach: 0 });
  });
  it("still splits the spots nobody paid for", () => {
    // 6 play, 1 charged late cancel, 1 spot never filled: only that last $8 is split.
    assert.deepEqual(shortfall(game, 6, 1), { gap: 800, extraEach: 133 });
  });
  it("never goes negative when a charged spot was filled again", () => {
    assert.deepEqual(shortfall(game, 8, 1), { gap: 0, extraEach: 0 });
  });
  it("never collects more than the court cost less the organizer's share", () => {
    for (let playing = 1; playing <= 8; playing++) {
      for (let late = 0; playing + late <= 8; late++) {
        const { extraEach } = shortfall(game, playing, late);
        const collected = (playing - 1) * (game.share_cents + extraEach) + late * game.share_cents;
        assert.ok(collected <= game.total_cents - game.share_cents, `${playing} playing, ${late} late: ${collected}`);
      }
    }
  });
});

describe("chargedLateCancels", () => {
  it("counts only late cancels whose charge went through", () => {
    assert.equal(
      chargedLateCancels([
        { late_cancel: "charged", hold_status: "captured" },
        { late_cancel: "charged", hold_status: "voided" }, // PayPal couldn't take it
        { late_cancel: "covered", hold_status: "voided" },
        { late_cancel: "pending", hold_status: "held" },
        { late_cancel: null, hold_status: "captured" },
      ]),
      1,
    );
  });
});

describe("capturedCents", () => {
  it("uses the amount PayPal reports", () => assert.equal(capturedCents({ amount: { currency_code: "USD", value: "9.14" } }, 1000), 914));
  it("falls back to what was asked when PayPal gives no amount (simulated holds)", () => {
    assert.equal(capturedCents({}, 800), 800);
    assert.equal(capturedCents({ amount: { currency_code: "USD", value: "abc" } }, 800), 800);
  });
});

describe("isTerminalPayPalError", () => {
  it("treats a gone or unusable hold as final", () => {
    assert.equal(isTerminalPayPalError(new PayPalError("x", 422, {})), true);
    assert.equal(isTerminalPayPalError(new PayPalError("x", 404, {})), true);
  });
  it("leaves everything else to be retried", () => {
    for (const status of [401, 403, 429, 500, 503]) assert.equal(isTerminalPayPalError(new PayPalError("x", status, {})), false, String(status));
    assert.equal(isTerminalPayPalError(new Error("timeout")), false);
  });
});

describe("verifyBody", () => {
  it("passes the event through byte for byte", () => {
    const raw = '{"id":"WH-1","resource":{"amount":{"value":"8.00"},"n":1.0,"s":"caf\\u00e9"}}';
    const body = verifyBody({ webhook_id: "W1", auth_algo: "SHA256withRSA" }, raw);
    assert.ok(body.endsWith(`,"webhook_event":${raw}}`));
    assert.equal(JSON.parse(body).webhook_id, "W1");
    assert.equal(JSON.parse(body).webhook_event.id, "WH-1");
  });
});

describe("cancelRule", () => {
  const cancelBy = new Date("2026-11-12T02:00:00Z"); // Wed 6pm Pacific
  it("names the deadline while it's ahead", () => assert.equal(cancelRule({ cancel_by: cancelBy }, new Date("2026-11-11T20:00:00Z")), "free cancel until Wed 6:00pm"));
  it("says so once it has passed", () => assert.equal(cancelRule({ cancel_by: cancelBy }, new Date("2026-11-12T20:00:00Z")), "free cancel has ended"));
});

describe("payoutUnderway", () => {
  it("is true once money has left or is leaving", () => {
    for (const s of ["sending", "pending", "sent", "unclaimed"] as const) assert.equal(payoutUnderway(s), true, s);
  });
  it("is false before a payout, after a failed one, or when there was nothing to pay", () => {
    for (const s of [null, "failed", "none"] as const) assert.equal(payoutUnderway(s), false, String(s));
  });
});

describe("gameDayLine", () => {
  const game = { starts_at: new Date("2026-11-13T02:00:00Z"), place: "Riverside" };
  const before = (mins: number) => new Date(game.starts_at.getTime() - mins * 60_000);
  it("says 2 hours when it is", () => assert.match(gameDayLine(game, before(115)), /^Game in 2 hours: Thu 6:00pm at Riverside/));
  it("doesn't claim 2 hours for a game set up later than that", () => {
    assert.match(gameDayLine(game, before(60)), /^Game in about an hour/);
    assert.match(gameDayLine(game, before(20)), /^Game starting soon/);
  });
});
