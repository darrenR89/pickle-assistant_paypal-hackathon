// Real texts for the phone demo, through Sendblue's free sandbox. A judge links their own phone to a
// demo by texting a code; the desktop still plays the rest of the group. Their texts go into the
// group chat as them, and the assistant's posts and their private messages come back as real texts.
// The sandbox has no webhooks, so src/bot/sendblue.ts checks for new texts every few seconds.
// Off unless the three SENDBLUE_* variables are set.

import { newToken, one, q } from "@/lib/db";
import { gameUrl } from "@/lib/games";
import { DEMO_PLAYER } from "@/lib/playground";
import { normalizePhone } from "@/lib/phone";

/** The path a short link stands for, or null for anything that isn't one of our game links. */
export function shortPath(url: string) {
  const base = process.env.APP_URL ?? "";
  if (!url.startsWith(`${base}/g/`)) return null;
  return url.slice(base.length);
}

/** A short link (APP_URL/s/code) for a game link, so the text shows one tidy link instead of a wrapped query string. */
async function shortLink(url: string) {
  const path = shortPath(url);
  if (!path) return url;
  const code = newToken().slice(0, 10);
  await q("insert into short_links (code, path) values ($1, $2)", [code, path]);
  return `${process.env.APP_URL}/s/${code}`;
}

// SENDBLUE_BASE_URL is only for pointing tests at a stand-in server.
const API = process.env.SENDBLUE_BASE_URL || "https://api.sendblue.com";

export function sendblueConfigured() {
  return Boolean(process.env.SENDBLUE_API_KEY && process.env.SENDBLUE_API_SECRET && process.env.SENDBLUE_FROM_NUMBER);
}

export function sendblueNumber() {
  return sendblueConfigured() ? (process.env.SENDBLUE_FROM_NUMBER ?? null) : null;
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

/**
 * Adds a number to the Sendblue contacts. On the free plan the bot can only text contacts, and only
 * after they've texted the number once (the join code does that). The plan allows 10 contacts.
 */
export async function addContact(number: string, firstName: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${API}/api/v2/contacts`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ number, first_name: firstName, sendblue_number: process.env.SENDBLUE_FROM_NUMBER, update_if_exists: true }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok || res.status === 409) return { ok: true };
    console.error("sendblue add contact failed", res.status, await res.text());
    return { ok: false, error: "The free texting line is full right now. Use the phone view instead." };
  } catch (err) {
    console.error("sendblue add contact failed", err);
    return { ok: false, error: "Couldn't reach the texting service. Use the phone view instead." };
  }
}

export type SendblueMessage = {
  message_handle: string;
  content?: string | null;
  from_number?: string | null;
  number?: string | null;
  is_outbound?: boolean;
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

/** "JOIN 4821" links a phone to the demo showing that code. */
export function joinCode(text: string) {
  return /^join\s*(\d{4})$/i.exec(text.trim())?.[1] ?? null;
}

/**
 * Game links in a text open as the person the phone is acting as, the way the on-screen phone demo
 * does: their own token on a plain game link, and the demo id so the page knows it's the demo.
 */
export function demoLinks(text: string, groupId: string, token: string) {
  const base = (process.env.APP_URL ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // via=sms makes the page's back button return to the Messages app.
  return text.replace(new RegExp(`${base}/g/([\\w-]+)(\\?[^\\s]*)?`, "g"), (_m, slug: string, query?: string) =>
    query ? `${process.env.APP_URL}/g/${slug}${query}&demo=${groupId}&via=sms` : `${process.env.APP_URL}/g/${slug}?p=${token}&demo=${groupId}&via=sms`,
  );
}

/**
 * Sends a post and its game link as two texts. Messages only draws a rich link preview for a link
 * sent on its own, and a short link keeps that bubble tidy if the preview isn't loaded.
 */
async function sendWithLink(phone: string, text: string, gameSlug: string | undefined, groupId: string, token: string) {
  await sendText(phone, demoLinks(text, groupId, token));
  if (gameSlug) await sendText(phone, await shortLink(demoLinks(gameUrl(gameSlug), groupId, token)));
}

type LinkedDemo = { phone: string; viewer: string; viewer_token: string };

/** The phone linked to this demo group by text, if any. */
async function linkedPhone(groupId: string) {
  if (!sendblueConfigured()) return null;
  return one<LinkedDemo>(
    `select g.demo_phone as phone, g.demo_viewer as viewer, p.token as viewer_token
     from groups g join people p on p.id = g.demo_viewer
     where g.id = $1 and g.demo_phone is not null and g.demo_code is null and g.demo_name is not null`,
    [groupId],
  );
}

/** The assistant's group posts, labelled so they read differently from private messages in the same thread. */
export async function deliverToGroup(groupId: string, text: string, gameSlug?: string) {
  const d = await linkedPhone(groupId);
  if (d) await sendWithLink(d.phone, `[Group] ${text}`, gameSlug, groupId, d.viewer_token);
}

/** Private messages to the organizer (the judge) or the player they try paying as. */
export async function deliverToPerson(groupId: string, personId: string, text: string, gameSlug?: string) {
  const d = await linkedPhone(groupId);
  if (!d) return;
  const p = await one<{ token: string; mine: boolean }>(
    `select p.token, (m.position = 0 or p.name = $3 or p.id = $4) as mine
     from group_members m join people p on p.id = m.person_id where m.group_id = $1 and p.id = $2`,
    [groupId, personId, DEMO_PLAYER, d.viewer],
  );
  if (p?.mine) await sendWithLink(d.phone, text, gameSlug, groupId, p.token);
}
