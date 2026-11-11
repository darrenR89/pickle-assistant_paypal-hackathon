// Polls Sendblue's free sandbox for new texts and hands them to the assistant, as the web
// playground does. Started from src/instrumentation.ts when SENDBLUE_* is set.

import { one, q } from "@/lib/db";
import { deliverToGroup, inboundSince, nameCommand, readSendblue, sendText } from "@/lib/sendblue";
import { handleGroupMessage } from "./assistant";
import { personByPhone } from "./people";

const GROUP_ID = "grp_sendblue";
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
  await q("insert into groups (id, name, sendblue) values ($1, 'Sendblue test', true) on conflict (id) do nothing", [GROUP_ID]);
  const person = await personByPhone(from);
  const joined = await one("insert into group_members (group_id, person_id) values ($1, $2) on conflict do nothing returning 1", [GROUP_ID, person.id]);
  // They texted us, so private updates are wanted and free to send.
  if (!person.texts_opt_in) await q("update people set texts_opt_in = true, texts_welcomed = true where id = $1", [person.id]);
  if (joined) {
    await sendText(
      from,
      "You're in the Sendblue test group. Messages marked [Group] are what everyone sees; the rest are just for you. " +
        "Text NAME and your first name so others see it (like NAME Sam). To start a game: @Assistant Thu 6pm Riverside, 4 spots, $40",
    );
  }
  const newName = nameCommand(text);
  if (newName) {
    await q("update people set name = $2 where id = $1", [person.id, newName]);
    await sendText(from, `Thanks, ${newName}.`);
    return;
  }
  // Show everyone else what was said, as a real group chat would.
  const name = (await one<{ name: string }>("select name from people where id = $1", [person.id]))?.name ?? from;
  await deliverToGroup(GROUP_ID, `${name}: ${text}`, undefined, person.id);
  await handleGroupMessage(GROUP_ID, person.id, text);
}
