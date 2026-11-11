import { test } from "node:test";
import assert from "node:assert/strict";
import { withRetry } from "./retry";

const noSleep = async () => {};

test("returns the first success without retrying", async () => {
  let calls = 0;
  const out = await withRetry(async () => ++calls, { attempts: 3, timeoutMs: 1000, waitMs: () => 0, sleep: noSleep });
  assert.equal(out, 1);
  assert.equal(calls, 1);
});

test("retries after a failure and returns the later success", async () => {
  let calls = 0;
  const waits: number[] = [];
  const out = await withRetry(
    async () => {
      calls++;
      if (calls < 3) throw new Error("fetch failed");
      return "ok";
    },
    { attempts: 3, timeoutMs: 1000, waitMs: (n) => n * 5000, sleep: async (ms) => void waits.push(ms) },
  );
  assert.equal(out, "ok");
  assert.deepEqual(waits, [5000, 10000]);
});

test("throws the last error once attempts run out", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        throw new Error(`fail ${++calls}`);
      },
      { attempts: 2, timeoutMs: 1000, waitMs: () => 0, sleep: noSleep },
    ),
    /fail 2/,
  );
});

test("aborts an attempt that hangs instead of waiting forever", async () => {
  let calls = 0;
  const out = await withRetry(
    (signal) => {
      calls++;
      if (calls === 1) {
        // Like the Render API call that hung: only the abort signal ends it.
        return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
      }
      return Promise.resolve("second try");
    },
    { attempts: 2, timeoutMs: 20, waitMs: () => 0, sleep: noSleep },
  );
  assert.equal(out, "second try");
});
