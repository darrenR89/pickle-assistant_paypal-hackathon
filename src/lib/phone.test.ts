import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizePhone } from "@/lib/phone";

describe("normalizePhone", () => {
  it("adds +1 to US numbers", () => {
    assert.equal(normalizePhone("(555) 123-4567"), "+15551234567");
    assert.equal(normalizePhone("1 555 123 4567"), "+15551234567");
  });
  it("rejects things that aren't numbers", () => {
    assert.equal(normalizePhone("abc"), undefined);
  });
});
