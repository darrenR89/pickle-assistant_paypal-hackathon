// Real texts through Sendblue's free sandbox, as a hands-on check that the assistant works over
// iMessage/SMS. The sandbox has no group chats and no webhooks, so:
// - a "Sendblue test" group is everyone who texts the number, and each group post goes to each member 1:1;
// - the server checks Sendblue for new texts every few seconds (src/bot/sendblue.ts).
// Off unless the three SENDBLUE_* variables are set.

import { one, q } from "@/lib/db";
import { outboundText } from "@/lib/blooio";
import { normalizePhone } from "@/lib/phone";

// SENDBLUE_BASE_URL is only for pointing tests at a stand-in server.
const API = process.env.SENDBLUE_BASE_URL || "https://api.sendblue.com";

export function sendblueConfigured() {
  return Boolean(process.env.SENDBLUE_API_KEY && process.env.SENDBLUE_API_SECRET && process.env.SENDBLUE_FROM_NUMBER);
}

function headers() {
  return {
    "sb-api-key-id": process.env.SENDBLUE_API_KEY ?? "",
    "sb-api-secret-key": process.env.SENDBLUE_API_SECRET ?? "",
    "Content-Type": "application/json",
  };
}

export async function sendText(number: string, content: string) {
  if (!sendblueConfigured()) return;
  try {
    const res = await fetch(`${API}/api/send-message`, {
      method: "POST",
      headers: headers(),
      // The free plan needs from_number on every send.
      body: JSON.stringify({ number, content, from_number: process.env.SENDBLUE_FROM_NUMBER }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) console.error("sendblue send failed", res.status, await res.text());
  } catch (err) {
    // The message is already saved; a failed text shouldn't stop the money flow that posted it.
    console.error("sendblue send failed", err);
  }
}

export type SendblueMessage = {
  message_handle: string;
  content?: string | null;
  from_number?: string | null;
  number?: string | null;
  is_outbound?: boolean;
  group_id?: string | null;
};

/** Texts people sent to our number since `since`, oldest first. */
export async function inboundSince(since: Date): Promise<SendblueMessage[]> {
  const params = new URLSearchParams({
    is_outbound: "false",
    sendblue_number: process.env.SENDBLUE_FROM_NUMBER ?? "",
    created_at_gte: since.toISOString(),
    order_by: "createdAt",
    order_direction: "asc",
    limit: "50",
  });
  const res = await fetch(`${API}/api/v2/messages?${params}`, { headers: headers(), signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`sendblue list failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { data?: SendblueMessage[] };
  return body.data ?? [];
}

/** The sender and text of an inbound message, or null when there's nothing to act on. */
export function readSendblue(m: SendblueMessage): { from: string; text: string } | null {
  if (m.is_outbound) return null;
  const text = (m.content ?? "").trim();
  const from = normalizePhone(m.from_number ?? m.number ?? undefined);
  return text && from ? { from, text } : null;
}

/** A group post, labelled so it reads differently from private messages in the same 1:1 thread. */
export function groupText(text: string, gameSlug?: string) {
  return outboundText(`[Group] ${text}`, gameSlug);
}

async function isSendblueGroup(groupId: string) {
  if (!sendblueConfigured()) return false;
  return !!(await one("select 1 from groups where id = $1 and sendblue", [groupId]));
}

/** Sends a group post to every member of the Sendblue test group, except `skipPersonId` (who wrote it). */
export async function deliverToGroup(groupId: string, text: string, gameSlug?: string, skipPersonId?: string) {
  if (!(await isSendblueGroup(groupId))) return;
  const members = await q<{ id: string; phone: string }>(
    "select p.id, p.phone from group_members m join people p on p.id = m.person_id where m.group_id = $1 order by m.position, p.name",
    [groupId],
  );
  for (const m of members) if (m.id !== skipPersonId) await sendText(m.phone, groupText(text, gameSlug));
}

export async function deliverToPerson(groupId: string, personId: string, text: string, gameSlug?: string) {
  if (!(await isSendblueGroup(groupId))) return;
  const p = await one<{ phone: string }>("select phone from people where id = $1", [personId]);
  if (p) await sendText(p.phone, outboundText(text, gameSlug));
}

/** "NAME Sam" sets how someone shows up in the group; the sandbox doesn't share contact names. */
export function nameCommand(text: string) {
  const m = /^name\s+(.{1,30})$/i.exec(text.trim());
  return m ? m[1].trim() : null;
}
