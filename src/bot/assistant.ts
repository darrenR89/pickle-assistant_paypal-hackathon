// The assistant's group-chat behavior. Channel-agnostic: the web playground calls
// handleGroupMessage, and so does the Blooio iMessage adapter (src/bot/imessage.ts).
//
// Rule: the AI only reads intent (a new game, or what a free-form message means).
// Every money movement below is deterministic code.

import { newId, newToken, one, q } from "@/lib/db";
import {
  type Game,
  type RosterEntry,
  gameUrl,
  getGame,
  holdCents,
  inviteeNames,
  isInvited,
  inPlayers,
  isBeforeCancelBy,
  logEvent,
  money,
  openGameForGroup,
  personById,
  roster,
  shortWhen,
  whenLabel,
} from "@/lib/games";
import { captureAuthorization, refundCapture, voidAuthorization } from "@/lib/paypal";
import { deliverToGroup, deliverToPerson } from "@/lib/blooio";
import { payOrganizer } from "./payout";
import { parseGameRequest, zonedTime } from "./parse";
import { type Decision, type GroupContext, buildContext, resolveMember, understand, worthReading } from "./agent";
import { KIND_LABEL, perCourt } from "./details";

const DEFAULT_CAP_CENTS = 200;
const CANCEL_BY_HOURS = 24;

// ---------- posting ----------

export async function postGroup(groupId: string, text: string, gameSlug?: string) {
  await q("insert into messages (group_id, sender_id, text, game_slug) values ($1, null, $2, $3)", [
    groupId,
    text,
    gameSlug ?? null,
  ]);
  await deliverToGroup(groupId, text, gameSlug);
}

/**
 * A private 1:1 message. Players only get these if they opted in (each new 1:1 chat costs us);
 * organizers always do, because they need to make decisions. In the playground it shows in that
 * person's inbox.
 */
export async function postDm(groupId: string, personId: string, text: string, gameSlug?: string, opts: { always?: boolean } = {}) {
  if (!opts.always) {
    const p = await one<{ texts_opt_in: boolean }>("select texts_opt_in from people where id = $1", [personId]);
    if (!p?.texts_opt_in) return;
  }
  await q("insert into messages (group_id, sender_id, dm_to, text, game_slug) values ($1, null, $2, $3, $4)", [
    groupId,
    personId,
    text,
    gameSlug ?? null,
  ]);
  await deliverToPerson(groupId, personId, text, gameSlug);
}

// ---------- intent matching ----------

const NO_GAME_HINT = "There's no game set up yet.";
const MENTION = /@(assistant|pickle\w*|bot)\b/i;
const SAYS_IN = /^\s*(i'?m\s+in|in|me|me too|count me in|\+1|i can play|i'?ll play|yes|yep)\b[\s!.]*$/i;
const SAYS_OUT = /^\s*(i'?m\s+out|out|can'?t make it|i can'?t (play|make it)|drop me|count me out)\b/i;

export async function handleGroupMessage(groupId: string, senderId: string, text: string) {
  await q("insert into messages (group_id, sender_id, text) values ($1, $2, $3)", [groupId, senderId, text]);

  const open = await openGameForGroup(groupId);

  if (MENTION.test(text)) {
    if (open && !/\b(new game|another game)\b/i.test(text) && !/\$|\d+\s*spots/i.test(text)) {
      await postGroup(groupId, `${(await rosterLine(open))} Tap to play:`, open.slug);
      return;
    }
    await createGame(groupId, senderId, text);
    return;
  }

  if (!open) {
    // "in" before any game exists: explain once how to start one, then stay quiet.
    if (SAYS_IN.test(text)) {
      const last = await q<{ text: string }>(
        "select text from messages where group_id = $1 and sender_id is null and dm_to is null order by id desc limit 1",
        [groupId],
      );
      if (!last[0]?.text.startsWith(NO_GAME_HINT)) {
        await postGroup(groupId, `${NO_GAME_HINT} Anyone can start one, like: "@Assistant Thu 6pm Riverside courts 3–4, 8 spots, $64"`);
      }
    }
    return;
  }
  // Exact one-word replies skip the model: fast, free, and unambiguous.
  if (SAYS_IN.test(text)) return saidIn(open, senderId);
  if (SAYS_OUT.test(text)) return playerOut(open, senderId);

  // Everything else: free-form. Most chatter never reaches the model.
  const lastSpoke = await one<{ at: Date }>(
    "select created_at as at from messages where group_id = $1 and sender_id is null and dm_to is null order by id desc limit 1",
    [groupId],
  );
  const recent = !!lastSpoke && Date.now() - new Date(lastSpoke.at).getTime() < 10 * 60_000;
  if (!worthReading(text, recent)) return;
  const ctx = await buildContext(groupId, senderId, open);
  const decision = await understand(ctx, text);
  await logEvent(open.id, senderId, "understood", { text, ...decision });
  await actOn(ctx, decision, text);
}

// ---------- acting on a free-form message ----------

async function actOn(ctx: GroupContext, d: Decision, text: string) {
  const game = ctx.game!;
  const groupId = game.group_id;
  const me = ctx.sender;
  const say = (t: string, withLink = false) => postGroup(groupId, t, withLink ? game.slug : undefined);
  const organizer = await personById(game.organizer_id);
  const entries = await roster(game.id);
  const mine = entries.find((e) => e.person_id === me.id);
  const left = game.spots - inPlayers(entries).length;

  // Unsure about something that changes the roster? Ask instead of acting.
  if (d.action !== "ignore" && d.confidence < 0.55) {
    if (d.reply || /@/.test(text)) await say(d.reply ?? `Sorry ${me.name}, I didn't follow. Are you in or out for ${whenLabel(game.starts_at)}?`);
    return;
  }
  if (d.action === "leave" && d.confidence < 0.7 && mine?.status === "in") {
    await say(`${me.name}, just checking: are you out for ${whenLabel(game.starts_at)}? Reply "out" to confirm.`);
    return;
  }

  switch (d.action) {
    case "ignore":
      return;
    case "join":
      return saidIn(game, me.id);
    case "leave":
      if (mine?.status === "in") return playerOut(game, me.id);
      await q("delete from intents where game_id = $1 and person_id = $2", [game.id, me.id]);
      return;
    case "maybe":
      if (mine?.status === "in") return;
      await q(
        "insert into intents (game_id, person_id, kind) values ($1, $2, 'maybe') on conflict (game_id, person_id) do update set kind = 'maybe'",
        [game.id, me.id],
      );
      return say(`No rush, ${me.name}. Spots go to whoever confirms first, so tap when you're sure:`, true);
    case "waitlist": {
      if (mine?.status === "in") return say(`${me.name}, you're already in.`);
      if (left > 0) return say(`${me.name}, ${left === 1 ? "there's still a spot" : `there are still ${left} spots`}. Grab one:`, true);
      await q(
        "insert into intents (game_id, person_id, kind) values ($1, $2, 'waitlist') on conflict (game_id, person_id) do update set kind = 'waitlist', said_at = now()",
        [game.id, me.id],
      );
      const pos = (await q("select 1 from intents where game_id = $1 and kind = 'waitlist'", [game.id])).length;
      return say(`${me.name}, you're #${pos} on the waitlist. I'll tag you the moment a spot opens.`);
    }
    case "give_spot": {
      if (mine?.status !== "in") return say(`${me.name}, you're not in this game, so there's no spot to give.`);
      const who = resolveMember(ctx.members, d.target);
      if (who.status === "many") return say(`${me.name}, which one: ${listWords(who.options)}?`);
      if (who.status !== "one") {
        return say(`${d.target ?? "They"} can claim your spot from the game page once they add their name and number. Share this:`, true);
      }
      const target = await one<{ id: string }>(
        "select p.id from people p join group_members m on m.person_id = p.id where m.group_id = $1 and p.name = $2",
        [groupId, who.name],
      );
      if (!target) return;
      await logEvent(game.id, me.id, "spot_offer", { to: target.id });
      await postDm(
        groupId,
        me.id,
        `Your spot is yours until ${who.name}'s hold goes through. Then your hold is released and you're not charged, even after free cancel.`,
      );
      return say(`${who.name}, ${me.name} is giving you their spot for ${whenLabel(game.starts_at)}. Tap to claim it:`, true);
    }
    case "invite": {
      // The organizer adding someone to an invite-only game.
      const member = resolveMember(ctx.members, d.target);
      if (game.invite_only && ctx.isOrganizer && member.status === "one") {
        const p = await one<{ id: string }>(
          "select p.id from people p join group_members m on m.person_id = p.id where m.group_id = $1 and p.name = $2",
          [groupId, member.name],
        );
        if (p) return grantInvite(game, p.id);
        return;
      }
      // Asking to bring someone to an invite-only game: the organizer decides, privately.
      if (game.invite_only && !ctx.isOrganizer) {
        return postDm(groupId, game.organizer_id, `${me.name} asked in the group: "${text.slice(0, 200)}". It's invite-only, so it's your call.`, `${game.slug}?o=${game.organizer_token}`, { always: true });
      }
      if (left <= 0) return say(`It's full right now. ${d.target ?? "Your friend"} can join the waitlist from the game page:`, true);
      return say(`${d.target ?? "They"} can join from the game page: add a name and number, then approve the hold. ${left === 1 ? "One spot" : `${left} spots`} left:`, true);
    }
    case "answer":
      return say(d.reply ?? answerFromFacts(text, game, entries.filter((e) => e.status === "in").map((e) => e.name)));
    case "private_money": {
      const p = await one<{ texts_opt_in: boolean }>("select texts_opt_in from people where id = $1", [me.id]);
      if (p?.texts_opt_in && mine) {
        await postDm(groupId, me.id, mine.hold_status === "held"
          ? `You have ${money(mine.hold_cents ?? 0)} on hold for ${whenLabel(game.starts_at)}. Nothing is charged until after the game.`
          : `Nothing is on hold for you for ${whenLabel(game.starts_at)}.`);
        return say(`${me.name}, I sent you the details privately.`);
      }
      return say(`${me.name}, your hold and receipt are on the game page. I keep money details out of the group:`, true);
    }
    case "change_request":
      if (!ctx.isOrganizer) return say(`Only ${organizer?.name ?? "the organizer"} can change the game. ${organizer?.name ?? "They"}, want to?`);
      await postDm(groupId, me.id, `Confirm the change here and I'll tell everyone (once people are in, changes can only help players):`, `${game.slug}?o=${game.organizer_token}`, { always: true });
      return say(`Got it, ${me.name}. Confirm it on your organizer page and I'll post the update.`);
    case "call_off":
      if (!ctx.isOrganizer) return say(`Only ${organizer?.name ?? "the organizer"} can call off the game.`);
      await postDm(groupId, me.id, `To call it off and release everyone's hold, confirm here:`, `${game.slug}?o=${game.organizer_token}`, { always: true });
      return say(`${me.name}, confirm on your organizer page and I'll release everyone's hold.`);
    case "ask_organizer":
      // Only the host knows (parking, balls, rules). Don't add noise to the group: pass it on privately.
      if (ctx.isOrganizer) return;
      return postDm(groupId, game.organizer_id, `${me.name} asked in the group: "${text.slice(0, 200)}"`, undefined, { always: true });
    case "clarify":
      return say(d.reply ?? `Sorry ${me.name}, can you say that another way?`);
    case "help":
      return say(`I keep track of the game. Say "in" or "out", ask "who's in?" or "what time?", "can Dana take my spot?", or "waitlist me". Money details always come to you privately.`);
  }
}

function answerFromFacts(text: string, game: Game, names: string[]) {
  const t = text.toLowerCase();
  const left = game.spots - names.length;
  if (/who'?s|how many|spots/.test(t)) return `${names.length} of ${game.spots} in: ${names.join(", ")}. ${left > 0 ? `${left} left.` : "Full."}`;
  if (/where|address|court/.test(t)) return `${game.place}${game.address ? `, ${game.address}` : ""}.`;
  if (/cancel/.test(t)) return `Free cancel until ${whenLabel(game.cancel_by)}. After that the organizer decides.`;
  if (/price|cost|how much/.test(t)) return `${money(game.share_cents)} each.`;
  return `${whenLabel(game.starts_at)} at ${game.place}.`;
}

/** Someone was offered this spot by a player who's still in. */
export async function spotOfferFor(gameId: string, personId: string) {
  const rows = await q<{ person_id: string }>(
    `select e.person_id from events e
     where e.game_id = $1 and e.kind = 'spot_offer' and e.detail->>'to' = $2
       and not exists (select 1 from events d where d.game_id = e.game_id and d.kind = 'spot_offer_done' and d.detail->>'to' = $2)
     order by e.id desc limit 1`,
    [gameId, personId],
  );
  return rows[0]?.person_id;
}

// ---------- creating a game ----------

async function createGame(groupId: string, organizerId: string, text: string) {
  const organizer = await personById(organizerId);
  const parsed = await parseGameRequest(text);
  // Spots and courts imply each other: 2 courts of doubles is 8 players, 8 players of singles is 4 courts.
  const each = perCourt(parsed.kind);
  let spotsNote = "";
  if (!parsed.spots && parsed.courtCount) {
    parsed.spots = parsed.courtCount * each;
    spotsNote = `I went with ${parsed.spots} spots for ${parsed.courtCount} court${parsed.courtCount === 1 ? "" : "s"} of ${parsed.kind === "singles" ? "singles" : "doubles"}.`;
  } else if (parsed.spots && !parsed.courtCount) {
    const need = Math.ceil(parsed.spots / each);
    spotsNote = `${parsed.spots} players of ${parsed.kind === "singles" ? "singles" : "doubles"} needs ${need} court${need === 1 ? "" : "s"}, so make sure ${need === 1 ? "it's" : "they're"} booked.`;
  } else if (parsed.spots && parsed.courtCount && parsed.spots > parsed.courtCount * each) {
    spotsNote = `${parsed.spots} players on ${parsed.courtCount} court${parsed.courtCount === 1 ? "" : "s"} means ${parsed.spots - parsed.courtCount * each} sit out each round.`;
  }
  // Prefill what we can. No spot or court count: assume 2 courts.
  if (!parsed.spots) {
    parsed.spots = 2 * each;
    spotsNote = `I put ${parsed.spots} spots, for 2 courts of ${parsed.kind === "singles" ? "singles" : "doubles"}.`;
  }
  // Anything the organizer didn't say that we can't guess: when, where, the court cost.
  // Then the game starts as a draft, and the link only goes to the group once those are in.
  const needs: string[] = [];
  if (!parsed.startsAt || !parsed.timeGiven) needs.push("when");
  if (!parsed.place) needs.push("place");
  if (!parsed.priceCents) needs.push("price");
  // Drafts the organizer abandoned in this chat give way to the new request.
  await q("update games set status = 'cancelled' where group_id = $1 and organizer_id = $2 and status = 'draft'", [groupId, organizerId]);

  const spots = parsed.spots;
  // A day without a time gets a 6pm placeholder; nothing at all gets tomorrow at 6pm.
  const startsAt = parsed.startsAt && parsed.timeGiven
    ? parsed.startsAt
    : sixPm(parsed.startsAt && parsed.dayGiven ? parsed.startsAt : new Date(Date.now() + 86400_000));
  const total = !parsed.priceCents ? 0 : parsed.priceIsTotal ? parsed.priceCents : parsed.priceCents * spots;
  const share = shareFor(total, spots);
  const kind = parsed.kind ?? null;
  const partners = kind && kind !== "singles" ? (parsed.partners ?? "rotating") : null;
  let endsAt: Date | null = null;
  if (parsed.durationMin) endsAt = new Date(startsAt.getTime() + parsed.durationMin * 60_000);
  else if (parsed.endHour) {
    const e = new Date(startsAt);
    const local = new Date(startsAt.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
    e.setTime(startsAt.getTime() + ((parsed.endHour.h - local.getHours()) * 60 + (parsed.endHour.m - local.getMinutes())) * 60_000);
    if (e > startsAt) endsAt = e;
  }

  // Invite-only. "invite only" alone means everyone in the chat right now; a name list narrows it.
  const groupPeople = await q<{ id: string; name: string }>(
    "select p.id, p.name from group_members m join people p on p.id = m.person_id where m.group_id = $1",
    [groupId],
  );
  const invited: Array<{ id: string; name: string }> = [];
  if (parsed.inviteOnly && !parsed.invitees?.length) invited.push(...groupPeople.filter((p) => p.id !== organizerId));
  if (parsed.invitees?.length) {
    const unknown: string[] = [];
    for (const n of parsed.invitees) {
      const hit = resolveMember(groupPeople.map((p) => p.name), n);
      if (hit.status === "one") invited.push(groupPeople.find((p) => p.name === hit.name)!);
      else unknown.push(n);
    }
    if (unknown.length) {
      await postGroup(groupId, `${organizer?.name ?? "Hey"}, I don't know ${listWords(unknown)} in this group yet. Add them to the chat first, or leave them out and try again.`);
      return;
    }
  }
  const cancelBy = new Date(startsAt.getTime() - CANCEL_BY_HOURS * 3600_000);
  const slug = `${shortWhen(startsAt).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${newToken().slice(0, 5)}`;
  const gameId = newId("game");
  const organizerToken = newToken();

  await q(
    `insert into games (id, slug, group_id, organizer_id, starts_at, place, spots, total_cents, share_cents,
       cap_cents, cancel_by, organizer_token, address, kind, partners, level, ends_at, setting, courts, invite_only, status, needs)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
    [gameId, slug, groupId, organizerId, startsAt, parsed.place ?? "", spots, total, share, DEFAULT_CAP_CENTS, cancelBy, organizerToken,
      parsed.address ?? null, kind, partners, parsed.level ?? null, endsAt, parsed.setting ?? null, parsed.courts ?? null, invited.length > 0, needs.length ? "draft" : "open", needs],
  );
  // The organizer is automatically in. They paid the court, so they don't need a hold.
  await q(
    "insert into spots (id, game_id, person_id, status, hold_status) values ($1, $2, $3, 'in', 'none')",
    [newId("spot"), gameId, organizerId],
  );
  for (const p of invited) {
    await q("insert into invites (game_id, person_id) values ($1, $2) on conflict do nothing", [gameId, p.id]);
  }
  await logEvent(gameId, organizerId, "created", { text, invited: invited.map((p) => p.name) });

  const game = (await getGame(slug))!;
  if (needs.length) {
    const day = parsed.dayGiven && parsed.startsAt ? dayName(startsAt) : null;
    await postGroup(groupId, `On it. ${organizer?.name ?? "The organizer"} is finishing the details${day ? ` for ${day}` : ""}, then I'll post the game here.`);
    await postDm(
      groupId,
      organizerId,
      `I started your game${day ? ` for ${day}` : ""} and filled in what I could.` +
        (spotsNote ? ` ${spotsNote}` : "") +
        ` Add ${listWords(needs.map((n) => NEED_WORDS[n] ?? n))} here and I'll post it to the group:`,
      `${slug}?o=${organizerToken}`,
      { always: true },
    );
    return;
  }
  await announce(game);
  await postDm(
    groupId,
    organizerId,
    `Your game is up. I used the usual terms: free cancel until 24 hours before, and up to ${money(DEFAULT_CAP_CENTS)} extra each if the game is short.` +
      (spotsNote ? ` ${spotsNote}` : "") +
      ` Change anything here (only you can see this link):`,
    `${slug}?o=${organizerToken}`,
    { always: true },
  );
}

const NEED_WORDS: Record<string, string> = { when: "the time", place: "where you're playing", price: "the court cost" };

function sixPm(d: Date) {
  const [m, day, y] = d.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "numeric", day: "numeric" }).split("/").map(Number);
  return zonedTime(y, m, day, 18, 0);
}
function dayName(d: Date) {
  return d.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", weekday: "long" });
}

/** Post the game link to the group. */
async function announce(game: Game) {
  const organizer = await personById(game.organizer_id);
  const host = organizer?.name ?? "the organizer";
  const where = [game.place, game.courts?.toLowerCase()].filter(Boolean).join(" ");
  const what = game.kind ? `${KIND_LABEL[game.kind]} · ` : "";
  let tail = " Tap to play:";
  if (game.invite_only) {
    const names = await inviteeNames(game.id);
    const members = await one<{ n: number }>("select count(*)::int as n from group_members where group_id = $1", [game.group_id]);
    tail = names.length >= (members?.n ?? 1) - 1
      ? ` Invite-only for everyone in this chat. Anyone added later, ask ${host}. Tap to play:`
      : ` Invite-only: ${listWords(names)}. Tap to play:`;
  }
  await postGroup(
    game.group_id,
    `${what}${whenLabel(game.starts_at)} · ${where} · ${game.spots} spots · ${money(game.share_cents)} each, free cancel until ${whenLabel(game.cancel_by)}.${tail}`,
    game.slug,
  );
}

// ---------- joining ----------

async function saidIn(game: Game, personId: string) {
  const entries = await roster(game.id);
  const mine = entries.find((e) => e.person_id === personId);
  const person = await personById(personId);
  if (mine?.status === "in") {
    await postGroup(game.group_id, `${person?.name}, you're already in.`);
    return;
  }
  if (!(await isInvited(game, personId))) return requestInvite(game, personId);
  if (inPlayers(entries).length >= game.spots) {
    await postGroup(game.group_id, `Sorry ${person?.name}, the game is full. Say "waitlist me" and I'll tag you if a spot opens.`);
    return;
  }
  await q(
    "insert into intents (game_id, person_id) values ($1, $2) on conflict (game_id, person_id) do nothing",
    [game.id, personId],
  );
  await postGroup(game.group_id, `${person?.name}, tap to confirm you're in:`, game.slug);
}

/**
 * Someone not on an invite-only list wants in. Ask the organizer privately first; the group
 * hears nothing unless the organizer says yes.
 */
export async function requestInvite(game: Game, personId: string) {
  const person = await personById(personId);
  const existing = await one<{ kind: string }>("select kind from intents where game_id = $1 and person_id = $2", [game.id, personId]);
  if (existing?.kind === "request") return;
  await q(
    "insert into intents (game_id, person_id, kind) values ($1, $2, 'request') on conflict (game_id, person_id) do update set kind = 'request', said_at = now()",
    [game.id, personId],
  );
  await logEvent(game.id, personId, "invite_requested");
  await postDm(
    game.group_id,
    game.organizer_id,
    `${person?.name} wants to join ${whenLabel(game.starts_at)}. It's invite-only, so it's your call: add them on your organizer page, or say "add ${person?.name}" in the chat.`,
    `${game.slug}?o=${game.organizer_token}`,
    { always: true },
  );
}

/** The organizer said yes: add them to the list and tell the group. */
export async function grantInvite(game: Game, personId: string) {
  const person = await personById(personId);
  const host = await personById(game.organizer_id);
  await q("insert into invites (game_id, person_id) values ($1, $2) on conflict do nothing", [game.id, personId]);
  await q("delete from intents where game_id = $1 and person_id = $2 and kind = 'request'", [game.id, personId]);
  await logEvent(game.id, personId, "invited");
  await postGroup(game.group_id, `${person?.name}, ${host?.name ?? "the organizer"} added you to ${whenLabel(game.starts_at)}. Tap to play:`, game.slug);
}

/** The organizer said not this time: nothing is posted in the group. */
export async function declineInvite(game: Game, personId: string) {
  await q("delete from intents where game_id = $1 and person_id = $2 and kind = 'request'", [game.id, personId]);
  await logEvent(game.id, personId, "invite_declined");
}

/** Called once a player's hold is approved. */
export async function playerJoined(game: Game, personId: string, authorizationId: string, holdCentsValue: number, orderId: string) {
  await q(
    `insert into spots (id, game_id, person_id, status, order_id, authorization_id, hold_cents, hold_status, authorized_at)
     values ($1, $2, $3, 'in', $4, $5, $6, 'held', now())
     on conflict (game_id, person_id) do update set status = 'in', order_id = $4, authorization_id = $5,
       hold_cents = $6, hold_status = 'held', late_cancel = null, authorized_at = now(), updated_at = now()`,
    [newId("spot"), game.id, personId, orderId, authorizationId, holdCentsValue],
  );
  await q("delete from intents where game_id = $1 and person_id = $2", [game.id, personId]);
  await logEvent(game.id, personId, "joined", { authorizationId, holdCents: holdCentsValue });

  // Taking over someone's spot: release theirs now that this hold is real.
  const giver = await spotOfferFor(game.id, personId);
  if (giver) {
    await logEvent(game.id, giver, "spot_offer_done", { to: personId });
    await playerOut(game, giver, { replaced: true });
  }

  await postGroup(game.group_id, await rosterLine(game));
  // First private text to someone who opted in: say who we are before anything else.
  const p = await one<{ name: string; texts_opt_in: boolean; texts_welcomed: boolean }>(
    "select name, texts_opt_in, texts_welcomed from people where id = $1",
    [personId],
  );
  if (p?.texts_opt_in && !p.texts_welcomed) {
    await postDm(game.group_id, personId, `Hi ${p.name}, it's the Pickleball Assistant from your group chat. I'll text you here about your games: receipts, reminders and refunds. Nothing about money goes in the group. Reply STOP anytime.`);
    await q("update people set texts_welcomed = true where id = $1", [personId]);
  }
  await postDm(
    game.group_id,
    personId,
    `You're in for ${whenLabel(game.starts_at)}. ${money(holdCentsValue)} is on hold; your share is ${money(game.share_cents)}. ` +
      `Nothing is charged until after the game, and cancelling before ${whenLabel(game.cancel_by)} releases it.`,
    game.slug,
  );
}

// ---------- leaving ----------

export async function playerOut(game: Game, personId: string, opts: { replaced?: boolean } = {}) {
  const entries = await roster(game.id);
  const mine = entries.find((e) => e.person_id === personId);
  const person = await personById(personId);
  await q("delete from intents where game_id = $1 and person_id = $2", [game.id, personId]);
  if (!mine || mine.status !== "in") return;

  if (personId === game.organizer_id) {
    await postGroup(game.group_id, `${person?.name}, you're the organizer. To call off the game, use your organizer link.`);
    return;
  }

  if (opts.replaced || isBeforeCancelBy(game) || mine.hold_status !== "held") {
    if (mine.authorization_id && mine.hold_status === "held") {
      await voidAuthorization(mine.authorization_id);
    }
    await q("update spots set status = 'out', hold_status = case when hold_status = 'held' then 'voided' else hold_status end, updated_at = now() where id = $1", [mine.id]);
    await logEvent(game.id, personId, "out", { late: false, replaced: !!opts.replaced });
    if (opts.replaced) return postDm(game.group_id, personId, `Your spot was claimed, so your ${money(mine.hold_cents ?? 0)} hold is released. No charge.`);
    await postGroup(game.group_id, `${person?.name} is out. ${await rosterLine(game)}`);
    await tagWaitlist(game);
    if (mine.hold_status === "held") {
      await postDm(game.group_id, personId, `You're out of ${whenLabel(game.starts_at)}. Your ${money(mine.hold_cents ?? 0)} hold is released.`);
    }
    return;
  }

  // Late cancel: keep the hold; the organizer decides.
  await q("update spots set status = 'out', late_cancel = 'pending', updated_at = now() where id = $1", [mine.id]);
  await logEvent(game.id, personId, "out", { late: true });
  await postGroup(game.group_id, `${person?.name} is out. ${await rosterLine(game)}`);
  await tagWaitlist(game);
  await postDm(
    game.group_id,
    personId,
    `You're out of ${whenLabel(game.starts_at)}. It's past the free-cancel time, so the organizer will decide whether your ${money(game.share_cents)} share is charged.`,
  );
  await postDm(
    game.group_id,
    game.organizer_id,
    `${person?.name} cancelled after the free-cancel time. Charge their ${money(game.share_cents)} share or cover it?`,
    `${game.slug}?o=${game.organizer_token}`,
    { always: true },
  );
}

/** A spot opened: tag the first person on the waitlist (first to approve the hold gets it). */
async function tagWaitlist(game: Game) {
  const next = await one<{ person_id: string; name: string }>(
    `select i.person_id, p.name from intents i join people p on p.id = i.person_id
     where i.game_id = $1 and i.kind = 'waitlist' order by i.said_at limit 1`,
    [game.id],
  );
  if (!next) return;
  await postGroup(game.group_id, `${next.name}, a spot just opened. It's yours if you grab it first:`, game.slug);
}

export async function resolveLateCancel(game: Game, spotId: string, decision: "charge" | "cover") {
  const entries = await roster(game.id);
  const spot = entries.find((e) => e.id === spotId && e.late_cancel === "pending");
  if (!spot || !spot.authorization_id) return;
  if (decision === "charge") {
    const capture = await captureAuthorization(spot.authorization_id, game.share_cents);
    await q("update spots set late_cancel = 'charged', hold_status = 'captured', captured_cents = $2, capture_id = $3, updated_at = now() where id = $1", [spot.id, game.share_cents, capture.id]);
    await postDm(game.group_id, spot.person_id, `Your ${money(game.share_cents)} share for ${whenLabel(game.starts_at)} was charged for the late cancel.`);
  } else {
    await voidAuthorization(spot.authorization_id);
    await q("update spots set late_cancel = 'covered', hold_status = 'voided', updated_at = now() where id = $1", [spot.id]);
    await postDm(game.group_id, spot.person_id, `Good news: the organizer covered your late cancel. Your hold is released.`);
  }
  await logEvent(game.id, spot.person_id, `late_cancel_${decision}`);
}

// ---------- reminders ----------

export async function nudgeUnfinished(game: Game) {
  const rows = await q<{ person_id: string; name: string }>(
    `select i.person_id, p.name from intents i join people p on p.id = i.person_id
     where i.game_id = $1 and not i.nudged`,
    [game.id],
  );
  if (!rows.length) return 0;
  for (const r of rows) {
    await postGroup(game.group_id, `${r.name}, you're not on the list yet. Tap to confirm:`, game.slug);
  }
  await q("update intents set nudged = true where game_id = $1", [game.id]);
  return rows.length;
}

// ---------- terms ----------

export type TermsChange = {
  startsAt?: Date;
  cancelBy?: Date;
  capCents?: number;
  totalCents?: number;
  spots?: number;
  address?: string;
  place?: string;
  courts?: string;
  kind?: Game["kind"];
  partners?: Game["partners"];
  level?: string;
  setting?: Game["setting"];
};

export async function updateTerms(game: Game, change: TermsChange) {
  const entries = await roster(game.id);
  const playersHolding = entries.some((e) => e.hold_status === "held");
  const draft = game.status === "draft";
  const oldStart = new Date(game.starts_at);
  const startsAt = change.startsAt ?? oldStart;
  const moved = startsAt.getTime() - oldStart.getTime();
  if (moved) {
    // Moving the game moves its end too. Free cancel moves with it, but never earlier for people already in.
    const endsAt = game.ends_at ? new Date(new Date(game.ends_at).getTime() + moved) : null;
    await q("update games set starts_at = $2, ends_at = $3, gameday_reminder_sent = false where id = $1", [game.id, startsAt, endsAt]);
  }
  const shiftedCancel = new Date(new Date(game.cancel_by).getTime() + (moved > 0 || !playersHolding ? moved : 0));
  const next = {
    cancelBy: change.cancelBy ?? (draft ? new Date(startsAt.getTime() - CANCEL_BY_HOURS * 3600_000) : shiftedCancel),
    capCents: change.capCents ?? game.cap_cents,
    totalCents: change.totalCents ?? game.total_cents,
    spots: change.spots ?? game.spots,
  };
  if (playersHolding) {
    // Once anyone is in, terms can only move in players' favor.
    if (next.cancelBy < new Date(game.cancel_by)) throw new Error("Free cancel can only move later once players are in.");
    if (next.capCents > game.cap_cents) throw new Error("The cap can only go down once players are in.");
    if (next.totalCents > game.total_cents) throw new Error("The price can only go down once players are in.");
    if (next.spots < inPlayers(entries).length) throw new Error("There are already more players in than that.");
  }
  const share = shareFor(next.totalCents, next.spots);
  if (playersHolding && share > game.share_cents) throw new Error("That would raise each share. Add spots only if the price drops too.");
  await q(
    "update games set cancel_by = $2, cap_cents = $3, total_cents = $4, spots = $5, share_cents = $6 where id = $1",
    [game.id, next.cancelBy, next.capCents, next.totalCents, next.spots, share],
  );
  // Where and what kind of game aren't money terms, so they can change any time.
  const text = (v: string | undefined | null, cur: string | null) => (v === undefined ? cur : (v ?? "").trim() || null);
  const address = text(change.address, game.address);
  const place = text(change.place, game.place) ?? game.place;
  const courts = text(change.courts, game.courts);
  const level = text(change.level, game.level);
  const kind = change.kind === undefined ? game.kind : change.kind;
  const partners = kind === "singles" ? null : change.partners === undefined ? game.partners : change.partners;
  const setting = change.setting === undefined ? game.setting : change.setting;
  await q(
    "update games set address = $2, place = $3, courts = $4, level = $5, kind = $6, partners = $7, setting = $8 where id = $1",
    [game.id, address, place, courts, level, kind, partners, setting],
  );
  await logEvent(game.id, game.organizer_id, "terms_changed", change);

  const parts: string[] = [];
  if (change.cancelBy && +change.cancelBy !== +new Date(game.cancel_by)) parts.push(`free cancel is now until ${whenLabel(next.cancelBy)}`);
  if (share !== game.share_cents) parts.push(`it's now ${money(share)} each`);
  if (next.spots !== game.spots) parts.push(`${next.spots} spots`);
  if (place !== game.place || courts !== game.courts) parts.push(`we're now at ${[place, courts?.toLowerCase()].filter(Boolean).join(" ")}`);
  if (address !== game.address && address) parts.push(`the address is ${address}`);
  if (kind !== game.kind && kind) parts.push(`it's ${KIND_LABEL[kind].toLowerCase()}`);
  if (partners !== game.partners && partners) parts.push(partners === "fixed" ? "partners are fixed" : "partners rotate each round");
  if (level !== game.level && level) parts.push(`level ${level}`);
  if (next.capCents !== game.cap_cents) parts.push(`short-game extra is now up to ${money(next.capCents)}`);
  if (draft) {
    // Still a draft: tick off what the organizer filled in, and post the game once nothing's missing.
    const needs = game.needs.filter((n) => !(n === "when" && change.startsAt) && !(n === "place" && place) && !(n === "price" && next.totalCents > 0));
    await q("update games set needs = $2 where id = $1", [game.id, needs]);
    if (!needs.length) {
      const posted = await q("update games set status = 'open' where id = $1 and status = 'draft' returning id", [game.id]);
      if (posted.length) {
        await announce((await getGame(game.slug))!);
        await postDm(game.group_id, game.organizer_id, "Your game is posted in the group.", undefined, { always: true });
      }
    }
    return;
  }
  if (moved) parts.unshift(`moved to ${whenLabel(startsAt)}`);
  if (parts.length) await postGroup(game.group_id, `Update: ${parts.join(", ")}.`, game.slug);
}

// ---------- settling ----------

/** How the organizer closes a game that ran short: split the gap (up to the cap) or cover it themselves. */
export type GapChoice = "split" | "cover";

/**
 * After the game: charge each player their share, plus an even part of any gap if the
 * game ran short (never more than the cap), unless the organizer chose to cover the gap.
 * The organizer absorbs what's left, then is paid back what was collected.
 */
export async function settleGame(game: Game, opts: { gap?: GapChoice } = {}) {
  // Claim the game so a scheduled run and the organizer's button can't both settle it.
  const claimed = await q("update games set status = 'settling' where id = $1 and status = 'open' returning id", [game.id]);
  if (!claimed.length) return;
  try {
    await settleClaimed(game, opts.gap ?? "split");
  } catch (err) {
    // Captures already done are recorded per player; a retry continues with the rest.
    await q("update games set status = 'open' where id = $1 and status = 'settling'", [game.id]);
    throw err;
  }
  // Settled is final; a payout problem is retried on its own and never reopens the game.
  await payOrganizer(game.id);
}

/** Each player's share of the court, rounded down to the cent; the organizer absorbs the leftover cents. */
export function shareFor(totalCents: number, spots: number) {
  return spots > 0 ? Math.floor(totalCents / spots) : 0;
}

/** What settling would charge each player, for the organizer's choice screen and for settle itself. */
export function shortfall(game: Pick<Game, "total_cents" | "share_cents" | "cap_cents" | "spots">, playingCount: number) {
  // The gap is the shares of empty spots. Cents lost to rounding the share down are the organizer's,
  // so a full game never has a gap. (min() keeps older games, whose shares were rounded up, unchanged.)
  const sharesTotal = Math.min(game.total_cents, game.spots * game.share_cents);
  const gap = Math.max(0, sharesTotal - playingCount * game.share_cents);
  // Rounded down: players never pay more than an exact split; the organizer absorbs the leftover cents.
  const extraEach = playingCount ? Math.min(game.cap_cents, Math.floor(gap / playingCount)) : 0;
  return { gap, extraEach };
}

async function settleClaimed(game: Game, choice: GapChoice) {
  const entries = await roster(game.id);
  const playing = inPlayers(entries);
  // Only players still holding are charged now; anyone captured on an earlier attempt is already done.
  const payers = playing.filter((e) => e.person_id !== game.organizer_id && e.hold_status === "held");
  const { gap, extraEach: splitEach } = shortfall(game, playing.length);
  const extraEach = choice === "cover" ? 0 : splitEach;

  for (const p of payers) {
    const amount = Math.min(game.share_cents + extraEach, p.hold_cents ?? 0);
    const capture = await captureAuthorization(p.authorization_id!, amount);
    await q("update spots set hold_status = 'captured', captured_cents = $2, capture_id = $3, updated_at = now() where id = $1", [p.id, amount, capture.id]);
    await postDm(
      game.group_id,
      p.person_id,
      `Thanks for playing! ${money(amount)} was charged for ${whenLabel(game.starts_at)}` +
        (extraEach ? ` (your ${money(game.share_cents)} share plus ${money(extraEach)} because the game was short).` : "."),
    );
  }
  // Late cancels nobody decided on are covered by default.
  for (const e of entries.filter((x) => x.late_cancel === "pending" && x.authorization_id)) {
    await voidAuthorization(e.authorization_id!);
    await q("update spots set late_cancel = 'covered', hold_status = 'voided' where id = $1", [e.id]);
  }
  const collected = await collectedCents(game.id, game.organizer_id);

  await q("update games set status = 'settled', close_choice = $2 where id = $1", [game.id, gap ? (choice === "cover" ? "covered" : "split") : null]);
  await logEvent(game.id, null, "settled", { collected, extraEach, choice: gap ? choice : null });
  await postGroup(game.group_id, `Good game! ${playing.length} played ${whenLabel(game.starts_at).split(" ")[0]}.`);
  const covered = entries.filter((e) => e.late_cancel === "covered" || e.late_cancel === "pending").map((e) => e.name);
  const yourPart = Math.max(0, game.total_cents - collected);
  await postDm(
    game.group_id,
    game.organizer_id,
    `${money(collected)} collected of ${money(game.total_cents)}. ${playing.length} played` +
      (covered.length ? `; you covered ${listWords(covered)}` : "") +
      (yourPart ? `. Your part of the court came to ${money(yourPart)}.` : "."),
    `${game.slug}?o=${game.organizer_token}`,
    { always: true },
  );
}

/** Money taken from players for this game, less refunds. The organizer's own spot never pays. */
export async function collectedCents(gameId: string, organizerId: string) {
  const row = await one<{ cents: string | null }>(
    `select sum(coalesce(captured_cents, 0) - refunded_cents) as cents from spots
     where game_id = $1 and hold_status = 'captured' and person_id <> $2`,
    [gameId, organizerId],
  );
  return Number(row?.cents ?? 0);
}

/**
 * Call the game off. Holds are released, unless free cancel has passed, the court fee is lost,
 * and the organizer chooses to charge everyone holding a spot their share (never more).
 */
export async function cancelGame(game: Game, opts: { charge?: boolean } = {}) {
  if (game.status === "draft") {
    // Never posted, so there's nothing to tell the group.
    await q("update games set status = 'cancelled' where id = $1", [game.id]);
    return;
  }
  if (opts.charge && isBeforeCancelBy(game)) throw new Error("Free cancel hasn't ended, so calling off releases everyone's hold.");
  const claimed = await q("update games set status = 'cancelling' where id = $1 and status = 'open' returning id", [game.id]);
  if (!claimed.length) return;
  try {
    const entries = await roster(game.id);
    for (const e of entries.filter((x) => x.hold_status === "held" && x.authorization_id)) {
      const owes = opts.charge && e.person_id !== game.organizer_id && (e.status === "in" || e.late_cancel === "pending");
      if (owes) {
        const amount = Math.min(game.share_cents, e.hold_cents ?? 0);
        const capture = await captureAuthorization(e.authorization_id!, amount);
        await q(
          `update spots set hold_status = 'captured', captured_cents = $2, capture_id = $3,
             late_cancel = case when late_cancel = 'pending' then 'charged' else late_cancel end, updated_at = now() where id = $1`,
          [e.id, amount, capture.id],
        );
        await postDm(
          game.group_id,
          e.person_id,
          `${whenLabel(game.starts_at)} is called off. The court fee couldn't be refunded, so your ${money(amount)} share was charged and the rest of your hold was released.`,
        );
        continue;
      }
      await voidAuthorization(e.authorization_id!);
      await q("update spots set hold_status = 'voided', late_cancel = case when late_cancel = 'pending' then 'covered' else late_cancel end where id = $1", [e.id]);
      if (e.person_id !== game.organizer_id) {
        await postDm(game.group_id, e.person_id, `${whenLabel(game.starts_at)} is cancelled. Your hold is released.`);
      }
    }
  } catch (err) {
    // Whatever was captured or released is recorded per player; a retry continues with the rest.
    await q("update games set status = 'open' where id = $1 and status = 'cancelling'", [game.id]);
    throw err;
  }
  await q("update games set status = 'cancelled', close_choice = $2 where id = $1", [game.id, opts.charge ? "charged" : "released"]);
  await logEvent(game.id, game.organizer_id, "cancelled", { charged: !!opts.charge });
  // The group never hears about money: only that the game is off.
  await postGroup(
    game.group_id,
    `${whenLabel(game.starts_at)} at ${game.place} is cancelled.` + (opts.charge ? "" : " All holds are released."),
  );
  if (opts.charge) {
    const collected = await collectedCents(game.id, game.organizer_id);
    await postDm(
      game.group_id,
      game.organizer_id,
      `Called off. ${money(collected)} of the ${money(game.total_cents)} court fee was collected from the players who were in.`,
      `${game.slug}?o=${game.organizer_token}`,
      { always: true },
    );
    await payOrganizer(game.id);
  }
}

// ---------- refunds ----------

/** A charged player says they did show up. The organizer decides privately. */
export async function requestRefund(game: Game, personId: string) {
  const spot = (await roster(game.id)).find((e) => e.person_id === personId);
  const owed = spot ? (spot.captured_cents ?? 0) - spot.refunded_cents : 0;
  if (!spot || spot.hold_status !== "captured" || owed <= 0) throw new Error("There's no charge to refund.");
  await q(
    `insert into intents (game_id, person_id, kind) values ($1, $2, 'refund')
     on conflict (game_id, person_id) do update set kind = 'refund', said_at = now()`,
    [game.id, personId],
  );
  await logEvent(game.id, personId, "refund_requested", { cents: owed });
  await postDm(
    game.group_id,
    game.organizer_id,
    `${spot.name} says they did show up for ${whenLabel(game.starts_at)}. Refund their ${money(owed)}?`,
    `${game.slug}?o=${game.organizer_token}`,
    { always: true },
  );
}

/** Refund what's left of a player's charge through PayPal. */
export async function refundSpot(game: Game, spotId: string) {
  const spot = (await roster(game.id)).find((e) => e.id === spotId);
  const owed = spot ? (spot.captured_cents ?? 0) - spot.refunded_cents : 0;
  if (!spot || spot.hold_status !== "captured" || owed <= 0) throw new Error("There's nothing left to refund.");
  if (!spot.capture_id) throw new Error("This charge was made before refunds were tracked, so it can't be refunded here.");
  // Claim the refund first so a double tap can't send two.
  const claimed = await q("update spots set refunded_cents = refunded_cents + $2, updated_at = now() where id = $1 and refunded_cents = $3 returning id", [
    spot.id,
    owed,
    spot.refunded_cents,
  ]);
  if (!claimed.length) return;
  try {
    await refundCapture(spot.capture_id, owed, `Refund for ${whenLabel(game.starts_at)}: the organizer confirmed you played.`);
  } catch (err) {
    await q("update spots set refunded_cents = refunded_cents - $2 where id = $1", [spot.id, owed]);
    throw err;
  }
  await q("delete from intents where game_id = $1 and person_id = $2 and kind = 'refund'", [game.id, spot.person_id]);
  await logEvent(game.id, spot.person_id, "refunded", { cents: owed });
  await postDm(game.group_id, spot.person_id, `${money(owed)} for ${whenLabel(game.starts_at)} was refunded to your PayPal or Venmo.`);
}

export async function declineRefund(game: Game, personId: string) {
  const gone = await q("delete from intents where game_id = $1 and person_id = $2 and kind = 'refund' returning person_id", [game.id, personId]);
  if (!gone.length) return;
  await logEvent(game.id, personId, "refund_declined");
  await postDm(game.group_id, personId, `The organizer kept the charge for ${whenLabel(game.starts_at)}. Reply here if you think that's wrong.`);
}

// ---------- helpers ----------

export async function rosterLine(game: Game) {
  const playing = inPlayers(await roster(game.id));
  const names = playing.map((p) => p.name).join(", ");
  const left = game.spots - playing.length;
  return `${playing.length} of ${game.spots} in: ${names}. ${left > 0 ? `${left} spot${left === 1 ? "" : "s"} left.` : "Game's full!"}`;
}

function listWords(words: string[]) {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

export { holdCents, gameUrl };
export type { RosterEntry };
