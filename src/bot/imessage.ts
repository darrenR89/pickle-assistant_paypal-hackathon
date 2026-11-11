// Real iMessage groups through Blooio (Chat SDK adapter). Inbound texts become the same calls the
// web playground makes, so the assistant behaves the same in both places.

import { createMemoryState } from "@chat-adapter/state-memory";
import { Chat } from "chat";
import { type BlooioMessagePayload, createBlooioAdapter } from "chat-adapter-blooio";
import { newId, one, q } from "@/lib/db";
import { type Inbound, readInbound, sendDirect } from "@/lib/blooio";
import { handleGroupMessage } from "./assistant";
import { personByPhone } from "./people";

const globalForChat = globalThis as unknown as { blooioChat?: Chat };

function chat() {
  if (!globalForChat.blooioChat) {
    const c = new Chat({
      userName: "pickle-assistant",
      adapters: {
        blooio: createBlooioAdapter({
          apiKey: process.env.BLOOIO_API_KEY,
          webhookSecret: process.env.BLOOIO_WEBHOOK_SECRET || undefined,
          defaultFromNumber: process.env.BLOOIO_FROM_NUMBER || undefined,
        }),
      },
      // One server, so in-memory dedupe is enough. Every message runs: "in" from three people at once must all count.
      state: createMemoryState(),
      concurrency: "concurrent",
      logger: "warn",
    });
    // Blooio marks every inbound text as addressed to the bot, so all of them arrive here.
    c.onNewMention(async (_thread, message) => {
      const msg = readInbound(message.raw as BlooioMessagePayload);
      if (msg) await receive(msg);
    });
    globalForChat.blooioChat = c;
  }
  return globalForChat.blooioChat;
}

export async function handleBlooioWebhook(req: Request, waitUntil: (task: Promise<unknown>) => void) {
  const c = chat();
  await c.initialize();
  return c.webhooks.blooio(req, { waitUntil });
}

async function receive(msg: Inbound) {
  const person = await personByPhone(msg.from, msg.name);

  if (!msg.groupChat) {
    // They texted us first, so private updates no longer count against Blooio's new-contact limit.
    if (!person.texts_opt_in) {
      await q("update people set texts_opt_in = true, texts_welcomed = true where id = $1", [person.id]);
      await sendDirect(msg.from, "Thanks! I'll text you here about your games: receipts, reminders and refunds. Nothing about money goes in the group.");
    }
    return;
  }

  const group =
    (await one<{ id: string }>("select id from groups where blooio_chat = $1", [msg.groupChat])) ??
    (await one<{ id: string }>(
      "insert into groups (id, name, blooio_chat) values ($1, $2, $3) on conflict (blooio_chat) do update set name = groups.name returning id",
      [newId("grp"), (msg.groupName ?? "iMessage group").slice(0, 60), msg.groupChat],
    ))!;
  await q("insert into group_members (group_id, person_id) values ($1, $2) on conflict do nothing", [group.id, person.id]);
  await handleGroupMessage(group.id, person.id, msg.text);
}
