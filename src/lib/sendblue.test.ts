import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupText, nameCommand, readSendblue } from "@/lib/sendblue";

describe("readSendblue", () => {
  it("reads an inbound text and normalizes the number", () => {
    assert.deepEqual(readSendblue({ message_handle: "h1", content: " in ", from_number: "+1 (555) 123-4567", is_outbound: false }), {
      from: "+15551234567",
      text: "in",
    });
  });
  it("falls back to `number` when from_number is missing", () => {
    assert.equal(readSendblue({ message_handle: "h2", content: "out", number: "5551234567" })?.from, "+15551234567");
  });
  it("skips our own messages and empty ones", () => {
    assert.equal(readSendblue({ message_handle: "h3", content: "hi", from_number: "+15551234567", is_outbound: true }), null);
    assert.equal(readSendblue({ message_handle: "h4", content: "  ", from_number: "+15551234567" }), null);
  });
});

describe("groupText", () => {
  it("labels group posts and keeps the game link on its own line", () => {
    process.env.APP_URL = "https://example.test";
    assert.equal(groupText("Tap to play:", "abc"), "[Group] Tap to play:\nhttps://example.test/g/abc");
  });
});

describe("nameCommand", () => {
  it("reads NAME followed by a name, any case", () => {
    assert.equal(nameCommand("NAME Sam"), "Sam");
    assert.equal(nameCommand("  name  Sam Lee "), "Sam Lee");
  });
  it("ignores other messages", () => {
    assert.equal(nameCommand("my name is Sam"), null);
    assert.equal(nameCommand("in"), null);
  });
});
