import { NextResponse } from "next/server";
import { newId, newToken, one, q } from "@/lib/db";
import { inPlayers, isInvited, openGameForGroup, roster } from "@/lib/games";
import { moveClock, runDue, simulatedJoin } from "@/lib/sim";
import { errorResponse } from "@/lib/http";

// Testing shortcuts for the /play demo only. Each one does what would otherwise need a PayPal
// login, another phone, or waiting days: add someone to the chat, place a simulated hold,
// move the game's clock, or run the scheduled jobs now. Refused for any real group.

type Body =
  | { action: "addPerson"; name?: string }
  | { action: "join"; personId?: string }
  | { action: "fill" }
  | { action: "time"; mode?: "week" | "before" | "gameday" | "soon" | "over" }
  | { action: "tick" }
  | { action: "phoneAs"; personId?: string };

// What players say in the group as they join. Some just tap the link and say nothing, like in a real chat.
const SAYS = ["I'm in!", "count me in", null, "in 🙌", "yep, in", null, "see you there", "in"];

/** A player's message in the group chat, shown as if they typed it. It isn't read by the assistant. */
async function say(groupId: string, personId: string, text: string | null) {
  if (text) await q("insert into messages (group_id, sender_id, text) values ($1, $2, $3)", [groupId, personId, text]);
}

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
        const pid = body.personId ?? "";
        const entries = await roster(game.id);
        const open = !entries.some((e) => e.person_id === pid && e.status === "in") && inPlayers(entries).length < game.spots;
        if (open && (await isInvited(game, pid))) await say(id, pid, "I'm in");
        const r = await simulatedJoin(game, pid);
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
          if (m.id !== game.organizer_id) await say(id, m.id, SAYS[added % SAYS.length]);
          const r = await simulatedJoin(game, m.id);
          if (!r.error) added++;
        }
        return NextResponse.json({ ok: true, added });
      }
      case "time": {
        if (!game) return NextResponse.json({ error: "Create a game first" }, { status: 409 });
        return NextResponse.json({ ok: true, label: await moveClock(game, body.mode ?? "over") });
      }
      case "phoneAs": {
        // "Your own phone": a phone paired by text speaks and is texted as this person, the way the walkthrough's
        // player step switches the phone to Jo. Inbound texts and the copies sent out both follow demo_viewer.
        const member = await one("select 1 from group_members where group_id = $1 and person_id = $2", [id, body.personId ?? ""]);
        if (!member) return NextResponse.json({ error: "That person isn't in this chat" }, { status: 400 });
        await q("update groups set demo_viewer = $2 where id = $1", [id, body.personId]);
        return NextResponse.json({ ok: true });
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

