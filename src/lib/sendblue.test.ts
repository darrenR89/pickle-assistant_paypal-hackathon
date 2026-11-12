import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoLinks, joinCode, outboundText, readSendblue } from "@/lib/sendblue";

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

describe("joinCode", () => {
  it("reads JOIN and a 4-digit code, any case and spacing", () => {
    assert.equal(joinCode("JOIN 4821"), "4821");
    assert.equal(joinCode(" join4821 "), "4821");
  });
  it("ignores other texts", () => {
    assert.equal(joinCode("join the game"), null);
    assert.equal(joinCode("JOIN 48210"), null);
  });
});

describe("demoLinks", () => {
  it("opens plain game links as the phone's person, and keeps organizer links", () => {
    process.env.APP_URL = "https://example.test";
    assert.equal(
      demoLinks("Tap to play:\nhttps://example.test/g/thu-6pm-ab12", "grp_1", "tok"),
      "Tap to play:\nhttps://example.test/g/thu-6pm-ab12?p=tok&demo=grp_1",
    );
    assert.equal(demoLinks("Yours: https://example.test/g/thu-6pm-ab12?o=org", "grp_1", "tok"), "Yours: https://example.test/g/thu-6pm-ab12?o=org&demo=grp_1");
    assert.equal(demoLinks("No link here", "grp_1", "tok"), "No link here");
  });
});

describe("outboundText", () => {
  it("puts the game link on its own line", () => {
    process.env.APP_URL = "https://example.test";
    assert.equal(outboundText("Tap to play:", "abc"), "Tap to play:\nhttps://example.test/g/abc");
    assert.equal(outboundText("No link"), "No link");
  });
});
