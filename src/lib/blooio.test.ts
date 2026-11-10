import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BlooioMessagePayload } from "chat-adapter-blooio";
import { outboundText, readInbound } from "@/lib/blooio";
import { normalizePhone } from "@/lib/phone";

function payload(over: Partial<BlooioMessagePayload>): BlooioMessagePayload {
  return {
    event: "message.received",
    message_id: "m1",
    external_id: "+15551234567",
    text: "in",
    attachments: [],
    protocol: "imessage",
    timestamp: 0,
    internal_id: "+15550000000",
    sender: "+15551234567",
    is_group: false,
    group_id: null,
    group_name: null,
    participants: null,
    ...over,
  };
}

describe("readInbound", () => {
  it("reads a group text with the sender's contact name", () => {
    const msg = readInbound(
      payload({
        is_group: true,
        group_id: "grp_abc",
        group_name: " Thursday crew ",
        participants: [{ contact_id: "c1", identifier: "+15551234567", name: "Sam" }],
      }),
    );
    assert.deepEqual(msg, { groupChat: "grp_abc", groupName: "Thursday crew", from: "+15551234567", name: "Sam", text: "in" });
  });

  it("treats a text without a group id as 1:1", () => {
    assert.deepEqual(readInbound(payload({ text: " hi " })), { from: "+15551234567", name: undefined, text: "hi" });
  });

  it("keeps an Apple ID email sender, lowercased", () => {
    assert.equal(readInbound(payload({ sender: "Sam@Example.com" }))?.from, "sam@example.com");
  });

  it("ignores empty texts (photos, tapbacks)", () => {
    assert.equal(readInbound(payload({ text: "  " })), null);
  });
});

describe("outboundText", () => {
  it("puts the game link on its own line", () => {
    process.env.APP_URL = "https://example.test";
    assert.equal(outboundText("Tap to play:", "abc"), "Tap to play:\nhttps://example.test/g/abc");
    assert.equal(outboundText("No link"), "No link");
  });
});

describe("normalizePhone", () => {
  it("adds +1 to US numbers", () => {
    assert.equal(normalizePhone("(555) 123-4567"), "+15551234567");
    assert.equal(normalizePhone("1 555 123 4567"), "+15551234567");
  });
  it("rejects things that aren't numbers", () => {
    assert.equal(normalizePhone("abc"), undefined);
  });
});
