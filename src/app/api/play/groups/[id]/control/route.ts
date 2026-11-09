import { NextResponse } from "next/server";
import { newId, newToken, one, q } from "@/lib/db";
import { type Game, holdCents, inPlayers, isInvited, logEvent, openGameForGroup, roster, whenLabel } from "@/lib/games";
import { newSimulatedAuthorization } from "@/lib/paypal";
import { nudgeUnfinished, playerJoined, postGroup, settleGame, spotOfferFor } from "@/bot/assistant";
import { errorResponse } from "@/lib/http";

// Testing shortcuts for the /play demo only. Each one does what would otherwise need a PayPal
// login, another phone, or waiting days: add someone to the chat, place a simulated hold,
// move the game's clock, or run the scheduled jobs now. Refused for any real group.

type Body =
  | { action: "addPerson"; name?: string }
  | { action: "join"; personId?: string }
  | { action: "fill" }
  | { action: "time"; mode?: "before" | "gameday" | "soon" | "over" }
  | { action: "tick" };

const HOUR = 3_600_000;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const group = await one<{ playground: boolean }>("select playground from groups where id = $1", [id]);
    if (!group?.playground) return NextResponse.json({ error: "Only demo groups have testing controls" }, { status: 403 });
    const body = (await req.json().catch(() => ({}))) as Body;
    const game = await openGameForGroup(id);

    switch (body.action) {
      case "addPerson": {
        const name = (body.name ?? "").trim().replace(/[^\p{L}' -]/gu, "").slice(0, 20);
        if (!name) return NextResponse.json({ error: "Add a name" }, { status: 400 });
        const pid = newId("per");
        await q("insert into people (id, name, phone, token, texts_opt_in) values ($1, $2, $3, $4, true)", [
          pid,
          name,
          `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
          newToken(),
        ]);
        await q("insert into group_members (group_id, person_id, position) values ($1, $2, 1000)", [id, pid]);
        await q("insert into messages (group_id, sender_id, text) values ($1, null, $2)", [id, `${name} was added to the chat`]);
        return NextResponse.json({ ok: true, personId: pid });
      }
      case "join": {
        if (!game) return NextResponse.json({ error: "Create a game first" }, { status: 409 });
        const r = await simulatedJoin(game, body.personId ?? "");
        return r.error ? NextResponse.json(r, { status: 409 }) : NextResponse.json(r);
      }
      case "fill": {
        if (!game) return NextResponse.json({ error: "Create a game first" }, { status: 409 });
        const members = await q<{ id: string }>("select person_id as id from group_members where group_id = $1 order by position", [id]);
        let added = 0;
        for (const m of members) {
          const entries = await roster(game.id);
          if (inPlayers(entries).length >= game.spots - 1) break; // leave one spot open for you
          if (entries.some((e) => e.person_id === m.id && e.status === "in")) continue;
          if (!(await isInvited(game, m.id))) continue;
          const r = await simulatedJoin(game, m.id);
          if (!r.error) added++;
        }
        return NextResponse.json({ ok: true, added });
      }
      case "time": {
        if (!game) return NextResponse.json({ error: "Create a game first" }, { status: 409 });
        const len = game.ends_at ? new Date(game.ends_at).getTime() - new Date(game.starts_at).getTime() : 2 * HOUR;
        const now = Date.now();
        const start =
          body.mode === "before" ? now + 3 * 24 * HOUR : body.mode === "gameday" ? now + 5 * HOUR : body.mode === "soon" ? now + 90 * 60_000 : now - 4 * HOUR;
        await q(
          `update games set starts_at = $2, ends_at = $3, cancel_by = $4,
             cancel_reminder_sent = $5, gameday_reminder_sent = $6 where id = $1`,
          [game.id, new Date(start), game.ends_at ? new Date(start + len) : null, new Date(start - 24 * HOUR), body.mode !== "before", body.mode === "over"],
        );
        const label = { before: "3 days before the game", gameday: "game day, after free cancel", soon: "90 minutes before the game", over: "after the game" }[body.mode ?? "over"];
        await logEvent(game.id, null, "demo_clock", { mode: body.mode });
        return NextResponse.json({ ok: true, label });
      }
      case "tick": {
        if (!game) return NextResponse.json({ ok: true, ran: [] });
        return NextResponse.json({ ok: true, ran: await runDue(game) });
      }
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return errorResponse(err);
  }
}

/** A hold placed without PayPal, so the demo can fill a game quickly. Same rules as a real join. */
async function simulatedJoin(game: Game, personId: string) {
  const member = await one("select 1 from group_members where group_id = $1 and person_id = $2", [game.group_id, personId]);
  if (!member) return { error: "Not in this chat" };
  const entries = await roster(game.id);
  if (entries.some((e) => e.person_id === personId && e.status === "in")) return { error: "Already in" };
  const offered = await spotOfferFor(game.id, personId);
  if (!offered && !(await isInvited(game, personId))) return { error: "Invite-only: not on the list. Say \"I'm in\" to ask the organizer." };
  if (!offered && inPlayers(entries).length >= game.spots) return { error: "The game is full" };
  const amount = holdCents(game);
  await playerJoined(game, personId, newSimulatedAuthorization(), amount, `SIM-ORDER-${newToken().slice(0, 10)}`);
  return { ok: true };
}

/** What the scheduled job would do for this game right now, run on demand. */
async function runDue(game: Game) {
  const now = Date.now();
  const ran: string[] = [];
  const cancelBy = new Date(game.cancel_by).getTime();
  const start = new Date(game.starts_at).getTime();
  if (!game.cancel_reminder_sent && cancelBy > now && cancelBy - now <= 3 * HOUR) {
    await q("update games set cancel_reminder_sent = true where id = $1", [game.id]);
    const n = await nudgeUnfinished(game);
    ran.push(`Free-cancel reminder (${n} nudged)`);
  }
  if (!game.gameday_reminder_sent && start > now && start - now <= 2 * HOUR) {
    await q("update games set gameday_reminder_sent = true where id = $1", [game.id]);
    await postGroup(game.group_id, `Game in 2 hours: ${whenLabel(game.starts_at)} at ${game.place}. See you there!`, game.slug);
    ran.push("Game-day reminder");
  }
  if (start <= now - 3 * HOUR) {
    await settleGame(game);
    ran.push("Settled the game");
  }
  return ran;
}
