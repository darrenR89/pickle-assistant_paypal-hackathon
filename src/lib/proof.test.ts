import { test } from "node:test";
import assert from "node:assert/strict";
import { proofMarkdown, proofRows, type ProofGame, type ProofSpot } from "./proof";

const game: ProofGame = {
  slug: "thu-6pm-abc12",
  starts_at: new Date("2026-11-12T02:00:00Z"),
  total_cents: 6400,
  payout_batch_id: "BATCH123",
  payout_cents: 5484,
  payout_status: "sent",
};

const spot = (over: Partial<ProofSpot>): ProofSpot => ({
  name: "Jo",
  order_id: null,
  authorization_id: null,
  capture_id: null,
  hold_cents: 1000,
  captured_cents: null,
  refunded_cents: 0,
  hold_status: "none",
  reauthorized: false,
  ...over,
});

test("simulated holds never appear in the proof", () => {
  const rows = proofRows({ ...game, payout_batch_id: "SIM-ABC" }, [
    spot({ order_id: "SIM-ORDER-1", authorization_id: "SIM-AUTH", capture_id: "SIM-CAP", hold_status: "captured" }),
  ]);
  assert.deepEqual(rows, []);
  assert.equal(proofMarkdown({ ...game, payout_batch_id: null }, [], []), null);
});

test("a real hold, partial capture, refund and payout each get a row", () => {
  const rows = proofRows(game, [
    spot({ order_id: "ORD1", authorization_id: "AUTH1", capture_id: "CAP1", captured_cents: 914, refunded_cents: 914, hold_status: "captured" }),
  ]);
  assert.deepEqual(
    rows.map((r) => [r[0], r[2], r[3]]),
    [
      ["Hold placed", "ORD1", "Jo, $10.00 order"],
      ["Hold authorized", "AUTH1", "Jo, $10.00 held"],
      ["Share charged", "CAP1", "Jo, $9.14 of $10.00 held"],
      ["Refunded", "CAP1", "Jo, $9.14"],
      ["Organizer paid back", "BATCH123", "$54.84, sent"],
    ],
  );
});

test("a voided and a renewed hold are listed", () => {
  const steps = proofRows({ ...game, payout_batch_id: null }, [
    spot({ order_id: "ORD2", authorization_id: "AUTH2", hold_status: "voided", reauthorized: true }),
  ]).map((r) => r[0]);
  assert.deepEqual(steps, ["Hold placed", "Hold authorized", "Hold renewed", "Hold released"]);
});

test("markdown has a table and lists only webhooks that arrived", () => {
  const md = proofMarkdown(game, [spot({ order_id: "ORD1", authorization_id: "AUTH1" })], [
    { type: "PAYMENT.CAPTURE.COMPLETED", count: 2 },
    { type: "PAYMENT.AUTHORIZATION.VOIDED", count: 0 },
  ]);
  assert.ok(md);
  assert.match(md, /\| Step \| PayPal API \| PayPal id \| Detail \|/);
  assert.match(md, /\| Hold placed \| .* \| ORD1 \|/);
  assert.match(md, /`PAYMENT\.CAPTURE\.COMPLETED` \(2\)/);
  assert.doesNotMatch(md, /VOIDED/);
});
