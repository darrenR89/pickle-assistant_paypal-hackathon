// iMessage through Blooio: sending, and reading Blooio's webhook payloads.
// Off unless BLOOIO_API_KEY is set, so the web playground keeps working without it.
// Only groups that started in iMessage (groups.blooio_chat is set) send anything here.

// Type-only import: the package is ESM-only, and the tests and Render Workflows load this file as CommonJS.
import type { BlooioClient, BlooioMessagePayload } from "chat-adapter-blooio";
import { one } from "@/lib/db";
import { gameUrl } from "@/lib/games";
import { normalizePhone } from "@/lib/phone";

export function blooioConfigured() {
  return Boolean(process.env.BLOOIO_API_KEY);
}

const globalForBlooio = globalThis as unknown as { blooioClient?: BlooioClient };

async function client() {
  if (!globalForBlooio.blooioClient) {
    const { BlooioClient } = await import("chat-adapter-blooio");
    globalForBlooio.blooioClient = new BlooioClient({
      apiKey: process.env.BLOOIO_API_KEY ?? "",
      defaultFromNumber: process.env.BLOOIO_FROM_NUMBER || undefined,
    });
  }
  return globalForBlooio.blooioClient;
}

/** The text as sent: iMessage shows a game link as a rich preview, so put it on its own line. */
export function outboundText(text: string, gameSlug?: string) {
  return gameSlug ? `${text}\n${gameUrl(gameSlug)}` : text;
}

export type Inbound = {
  /** Blooio's group id for a group message, otherwise undefined (a 1:1 text). */
  groupChat?: string;
  groupName?: string;
  /** Sender's phone in E.164, or their Apple ID email when iMessage gives no number. */
  from: string;
  /** The sender's contact name if Blooio knows it. */
  name?: string;
  text: string;
};

/** What we need from an inbound Blooio message, or null when there's nothing to act on. */
export function readInbound(p: BlooioMessagePayload): Inbound | null {
  const text = (p.text ?? "").trim();
  const raw = (p.sender ?? "").trim();
  if (!text || !raw) return null;
  const from = raw.includes("@") ? raw.toLowerCase() : normalizePhone(raw);
  if (!from) return null;
  const name = p.participants?.find((x) => x.identifier === raw)?.name?.trim() || undefined;
  if (p.is_group && p.group_id) {
    return { groupChat: p.group_id, groupName: p.group_name?.trim() || undefined, from, name, text };
  }
  return { from, name, text };
}

async function send(to: string, text: string) {
  try {
    await (await client()).sendMessage(to, { text });
  } catch (err) {
    // The message is already saved; a failed text shouldn't stop the money flow that posted it.
    console.error("blooio send failed", err);
  }
}

/** Mirrors a group post to iMessage when the group lives there. */
export async function deliverToGroup(groupId: string, text: string, gameSlug?: string) {
  if (!blooioConfigured()) return;
  const g = await one<{ blooio_chat: string | null }>("select blooio_chat from groups where id = $1", [groupId]);
  if (g?.blooio_chat) await send(g.blooio_chat, outboundText(text, gameSlug));
}

/** Mirrors a private message to the person's own 1:1 iMessage thread, for groups that live in iMessage. */
export async function deliverToPerson(groupId: string, personId: string, text: string, gameSlug?: string) {
  if (!blooioConfigured()) return;
  const r = await one<{ blooio_chat: string | null; phone: string }>(
    "select g.blooio_chat, p.phone from groups g, people p where g.id = $1 and p.id = $2",
    [groupId, personId],
  );
  if (r?.blooio_chat) await send(r.phone, outboundText(text, gameSlug));
}

export async function sendDirect(to: string, text: string) {
  if (blooioConfigured()) await send(to, text);
}
