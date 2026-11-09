// The assistant's group-chat behavior. Channel-agnostic: the web playground calls
// handleGroupMessage today; a Chat SDK adapter (Blooio, etc.) can call it later.
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
import { captureAuthorization, voidAuthorization } from "@/lib/paypal";
import { parseGameRequest } from "./parse";
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
        if (p) await q("insert into invites (game_id, person_id) values ($1, $2) on conflict do nothing", [game.id, p.id]);
        return say(`${member.name}, you're invited to ${whenLabel(game.starts_at)}. Tap to play:`, true);
      }
      if (game.invite_only && !ctx.isOrganizer) return say(`This one's invite-only, so ${organizer?.name ?? "the organizer"} decides who comes.`);
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
  // Decide what's missing from the values themselves, not from the model's list.
  const missing = new Set<string>();
  if (!parsed.startsAt) missing.add("starts_at");
  // Spots and courts imply each other: 2 courts of doubles is 8 players, 8 players of singles is 4 courts.
  const each = perCourt(parsed.kind);
  let spotsNote = "";
  if (!parsed.spots && parsed.courtCount) {
    parsed.spots = parsed.courtCount * each;
    spotsNote = `${parsed.spots} spots for ${parsed.courtCount} court${parsed.courtCount === 1 ? "" : "s"} of ${parsed.kind === "singles" ? "singles" : "doubles"}`;
  } else if (parsed.spots && !parsed.courtCount) {
    const need = Math.ceil(parsed.spots / each);
    spotsNote = `${parsed.spots} players is ${need} court${need === 1 ? "" : "s"} of ${parsed.kind === "singles" ? "singles" : "doubles"}`;
  } else if (parsed.spots && parsed.courtCount && parsed.spots > parsed.courtCount * each) {
    spotsNote = `${parsed.spots} players on ${parsed.courtCount} court${parsed.courtCount === 1 ? "" : "s"} means ${parsed.spots - parsed.courtCount * each} sit out each round`;
  }
  if (!parsed.spots) missing.add("spots");
  if (!parsed.priceCents) missing.add("price");
  if (!parsed.place) missing.add("place");

  if (missing.size) {
    const words: Record<string, string> = {
      starts_at: "when",
      place: "where",
      spots: "how many spots (or how many courts)",
      price: "the court cost",
    };
    const ask = [...missing].map((m) => words[m] ?? m);
    await postGroup(
      groupId,
      `${organizer?.name ?? "Hey"}, I can set that up. I just need ${listWords(ask)}. ` +
        `For example: "@Assistant Thu 6pm Riverside courts 3–4, 8 spots, $64"`,
    );
    return;
  }

  const spots = parsed.spots!;
  const startsAt = parsed.startsAt!;
  const total = parsed.priceIsTotal ? parsed.priceCents! : parsed.priceCents! * spots;
  const share = Math.ceil(total / spots);
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

  // Invite-only: every name must be someone in this group.
  const groupPeople = await q<{ id: string; name: string }>(
    "select p.id, p.name from group_members m join people p on p.id = m.person_id where m.group_id = $1",
    [groupId],
  );
  const invited: Array<{ id: string; name: string }> = [];
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
       cap_cents, cancel_by, organizer_token, address, kind, partners, level, ends_at, setting, courts, invite_only)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [gameId, slug, groupId, organizerId, startsAt, parsed.place, spots, total, share, DEFAULT_CAP_CENTS, cancelBy, organizerToken,
      parsed.address ?? null, kind, partners, parsed.level ?? null, endsAt, parsed.setting ?? null, parsed.courts ?? null, invited.length > 0],
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
  const where = [game.place, game.courts?.toLowerCase()].filter(Boolean).join(" ");
  const what = kind ? `${KIND_LABEL[kind]} · ` : "";
  await postGroup(
    groupId,
    `${what}${whenLabel(startsAt)} · ${where} · ${spots} spots · ${money(share)} each, free cancel until ${whenLabel(cancelBy)}.` +
      (invited.length ? ` Invite-only: ${listWords(invited.map((p) => p.name))}. Tap to play:` : " Tap to play:"),
    slug,
  );
  await postDm(
    groupId,
    organizerId,
    `Your game is up. I used the usual terms: free cancel until 24 hours before, and up to ${money(DEFAULT_CAP_CENTS)} extra each if the game is short.` +
      (spotsNote ? ` I went with ${spotsNote}.` : "") +
      ` Change anything here (only you can see this link):`,
    `${slug}?o=${organizerToken}`,
    { always: true },
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
  if (!(await isInvited(game, personId))) {
    const host = await personById(game.organizer_id);
    await postGroup(game.group_id, `${person?.name}, this one's invite-only. ${host?.name ?? "The organizer"} can add you.`);
    return;
  }
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
    await captureAuthorization(spot.authorization_id, game.share_cents);
    await q("update spots set late_cancel = 'charged', hold_status = 'captured', captured_cents = $2, updated_at = now() where id = $1", [spot.id, game.share_cents]);
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
  const next = {
    cancelBy: change.cancelBy ?? new Date(game.cancel_by),
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
  const share = Math.ceil(next.totalCents / next.spots);
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
  if (parts.length) await postGroup(game.group_id, `Update: ${parts.join(", ")}.`, game.slug);
}

// ---------- settling ----------

/**
 * After the game: charge each player their share, plus an even part of any gap if the
 * game ran short (never more than the cap). The organizer absorbs what's left.
 */
export async function settleGame(game: Game) {
  // Claim the game so a scheduled run and the organizer's button can't both settle it.
  const claimed = await q("update games set status = 'settling' where id = $1 and status = 'open' returning id", [game.id]);
  if (!claimed.length) return;
  try {
    await settleClaimed(game);
  } catch (err) {
    // Captures already done are recorded per player; a retry continues with the rest.
    await q("update games set status = 'open' where id = $1 and status = 'settling'", [game.id]);
    throw err;
  }
}

async function settleClaimed(game: Game) {
  const entries = await roster(game.id);
  const playing = inPlayers(entries);
  const payers = playing.filter((e) => e.person_id !== game.organizer_id && e.hold_status === "held");
  const sharesCovered = playing.length * game.share_cents;
  const gap = Math.max(0, game.total_cents - sharesCovered);
  const extraEach = playing.length ? Math.min(game.cap_cents, Math.ceil(gap / playing.length)) : 0;

  let collected = 0;
  for (const p of payers) {
    const amount = Math.min(game.share_cents + extraEach, p.hold_cents ?? 0);
    await captureAuthorization(p.authorization_id!, amount);
    await q("update spots set hold_status = 'captured', captured_cents = $2, updated_at = now() where id = $1", [p.id, amount]);
    collected += amount;
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
  const alreadyCaptured = entries
    .filter((e) => e.hold_status === "captured" && !payers.some((p) => p.id === e.id))
    .reduce((s, e) => s + (e.captured_cents ?? 0), 0);
  collected += alreadyCaptured;

  await q("update games set status = 'settled' where id = $1", [game.id]);
  await logEvent(game.id, null, "settled", { collected, extraEach });
  await postGroup(game.group_id, `Good game! ${playing.length} played ${whenLabel(game.starts_at).split(" ")[0]}.`);
  const covered = entries.filter((e) => e.late_cancel === "covered" || e.late_cancel === "pending").map((e) => e.name);
  await postDm(
    game.group_id,
    game.organizer_id,
    `${money(collected)} collected of ${money(game.total_cents)}. ${playing.length} played` +
      (covered.length ? `; you covered ${listWords(covered)}.` : ".") +
      ` Payout to your PayPal or Venmo comes next in the build.`,
    `${game.slug}?o=${game.organizer_token}`,
    { always: true },
  );
}

export async function cancelGame(game: Game) {
  if (game.status !== "open") return;
  const entries = await roster(game.id);
  for (const e of entries.filter((x) => x.hold_status === "held" && x.authorization_id)) {
    await voidAuthorization(e.authorization_id!);
    await q("update spots set hold_status = 'voided' where id = $1", [e.id]);
    if (e.person_id !== game.organizer_id) {
      await postDm(game.group_id, e.person_id, `${whenLabel(game.starts_at)} is cancelled. Your hold is released.`);
    }
  }
  await q("update games set status = 'cancelled' where id = $1", [game.id]);
  await logEvent(game.id, game.organizer_id, "cancelled");
  await postGroup(game.group_id, `${whenLabel(game.starts_at)} at ${game.place} is cancelled. All holds are released.`);
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
