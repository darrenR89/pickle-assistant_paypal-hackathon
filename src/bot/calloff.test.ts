import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { callOffRefunds } from "@/bot/assistant";

type Entry = Parameters<typeof callOffRefunds>[0][number];
const spot = (over: Partial<Entry> = {}): Entry => ({
  person_id: "per_jo",
  late_cancel: "charged",
  hold_status: "captured",
  captured_cents: 800,
  refunded_cents: 0,
  capture_id: "CAP-1",
  ...over,
});
const cents = (entries: Entry[]) => callOffRefunds(entries, "per_org").map((r) => [r.spot.person_id, r.cents]);

describe("callOffRefunds (a called-off game gives back charged late cancels)", () => {
  it("refunds a charged late cancel in full", () => {
    assert.deepEqual(cents([spot()]), [["per_jo", 800]]);
  });
  it("refunds only what hasn't been refunded already", () => {
    assert.deepEqual(cents([spot({ refunded_cents: 300 })]), [["per_jo", 500]]);
    assert.deepEqual(cents([spot({ refunded_cents: 800 })]), []);
  });
  it("leaves out players who were never charged, or whose charge PayPal didn't take", () => {
    assert.deepEqual(
      cents([
        spot({ person_id: "per_a", late_cancel: "pending", hold_status: "held" }), // released with everyone else
        spot({ person_id: "per_b", late_cancel: "covered", hold_status: "voided" }),
        spot({ person_id: "per_c", late_cancel: "charged", hold_status: "voided" }), // capture failed
        spot({ person_id: "per_d", late_cancel: null, hold_status: "held" }), // still in: hold released, not refunded
        spot({ person_id: "per_e", late_cancel: "charged", captured_cents: null }),
      ]),
      [],
    );
  });
  it("skips a charge with no capture id, which PayPal can't refund from here", () => {
    assert.deepEqual(cents([spot({ capture_id: null })]), []);
  });
  it("never refunds the organizer's own spot", () => {
    assert.deepEqual(cents([spot({ person_id: "per_org" })]), []);
  });
  it("refunds every charged late cancel in the game", () => {
    assert.deepEqual(cents([spot({ person_id: "per_a" }), spot({ person_id: "per_b", captured_cents: 650, capture_id: "CAP-2" })]), [
      ["per_a", 800],
      ["per_b", 650],
    ]);
  });
});
