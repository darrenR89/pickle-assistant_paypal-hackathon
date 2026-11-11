import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allow, clientIp } from "@/lib/rate";

describe("allow", () => {
  it("lets calls through up to the limit, then refuses", () => {
    const key = `t1-${Math.random()}`;
    assert.deepEqual([1, 2, 3, 4].map(() => allow(key, 3, 1000, 0)), [true, true, true, false]);
  });
  it("starts fresh once the window has passed", () => {
    const key = `t2-${Math.random()}`;
    allow(key, 1, 1000, 0);
    assert.equal(allow(key, 1, 1000, 500), false);
    assert.equal(allow(key, 1, 1000, 1000), true);
  });
  it("counts each key on its own", () => {
    const a = `t3a-${Math.random()}`;
    const b = `t3b-${Math.random()}`;
    allow(a, 1, 1000, 0);
    assert.equal(allow(b, 1, 1000, 0), true);
  });
});

describe("clientIp", () => {
  it("takes the first address the proxy reports", () => {
    assert.equal(clientIp(new Request("http://x", { headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" } })), "203.0.113.7");
    assert.equal(clientIp(new Request("http://x")), "unknown");
  });
});
