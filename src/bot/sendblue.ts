// Polls Sendblue's free sandbox for new texts and routes them into the phone demo. Started from
// src/instrumentation.ts when SENDBLUE_* is set.

import { one, q } from "@/lib/db";
import { SETUP_MESSAGE, demoAct } from "@/lib/demo";
import { inboundSince, joinCode, readSendblue, sendText } from "@/lib/sendblue";
import { handleGroupMessage } from "./assistant";

const EVERY_MS = 4000;
// Re-read a little of the past each time so nothing slips between polls; seen messages are skipped.
const OVERLAP_MS = 2 * 60_000;

const g = globalThis as unknown as { sendblueTimer?: NodeJS.Timeout };

export function startSendbluePoller() {
  if (g.sendblueTimer) return;
  let busy = false;
  const startedAt = Date.now();
  g.sendblueTimer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      // Never reach back before the server started, so a restart doesn't replay old texts.
      const since = new Date(Math.max(startedAt - 30_000, Date.now() - OVERLAP_MS));
      for (const m of await inboundSince(since)) {
        const fresh = await one("insert into sendblue_seen (message_handle) values ($1) on conflict do nothing returning 1", [m.message_handle]);
        const msg = fresh ? readSendblue(m) : null;
        if (msg) await receive(msg.from, msg.text);
      }
    } catch (err) {
      console.error("sendblue poll failed", err);
    } finally {
      busy = false;
    }
  }, EVERY_MS);
  console.log("Sendblue: checking for new texts every", EVERY_MS / 1000, "seconds");
}

async function receive(from: string, text: string) {
  const code = joinCode(text);
  if (code) {
    const pending = await one<{ id: string; name: string }>(
      "select id, demo_phone_name as name from groups where demo_code = $1 and demo_phone = $2 order by created_at desc limit 1",
      [code, from],
    );
    if (!pending) {
      await sendText(from, "That code doesn't match. Check the code on the demo page and the number you typed there.");
      return;
    }
    const r = await demoAct(pending.id, { action: "connect", name: pending.name });
    if (!r.ok) return sendText(from, r.note);
    // One phone drives one demo at a time: unlink it from any older one.
    await q("update groups set demo_phone = null where demo_phone = $1 and id <> $2", [from, pending.id]);
    await q("update groups set demo_code = null where id = $1", [pending.id]);
    await sendText(
      from,
      `You're connected, ${pending.name}. You're the organizer in the group chat on the demo page. Text the assistant to set up a game, like:\n${SETUP_MESSAGE}`,
    );
    return;
  }

  const demo = await one<{ id: string; viewer: string }>(
    "select id, demo_viewer as viewer from groups where demo_phone = $1 and demo_code is null and demo_viewer is not null order by created_at desc limit 1",
    [from],
  );
  if (!demo) {
    await sendText(from, `Open ${process.env.APP_URL ?? "the app"}/demo, add your number there, and text the code it shows to start.`);
    return;
  }
  // The phone speaks as whoever it's acting as in the demo: the organizer, or the player it switched to.
  await handleGroupMessage(demo.id, demo.viewer, text);
}
