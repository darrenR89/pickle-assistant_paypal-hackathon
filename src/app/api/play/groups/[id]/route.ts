import { NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { type Game, inPlayers, money, roster, whenLabel } from "@/lib/games";
import { groupPeople } from "@/lib/playground";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

type Msg = { id: string; sender_id: string | null; dm_to: string | null; text: string; game_slug: string | null; created_at: Date };

// Everything the playground needs to draw one group: people, the group thread,
// the viewer's private inbox, and a preview card for each linked game.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const viewer = new URL(req.url).searchParams.get("viewer");
    const group = await one<{ id: string; name: string }>("select id, name from groups where id = $1", [id]);
    if (!group) return NextResponse.json({ error: "Unknown group" }, { status: 404 });

    const people = await groupPeople(id);
    const messages = await q<Msg>(
      `select id, sender_id, dm_to, text, game_slug, created_at from messages
       where group_id = $1 and (dm_to is null or dm_to = $2) order by id`,
      [id, viewer ?? ""],
    );

    const slugs = [...new Set(messages.map((m) => m.game_slug?.split("?")[0]).filter(Boolean))] as string[];
    const cards: Record<string, unknown> = {};
    for (const slug of slugs) {
      const game = await one<Game>("select * from games where slug = $1", [slug]);
      if (!game) continue;
      const playing = inPlayers(await roster(game.id));
      cards[slug] = {
        title: `${whenLabel(game.starts_at)} · ${game.place}`,
        subtitle:
          game.status === "open"
            ? `${playing.length} of ${game.spots} in · ${money(game.share_cents)} each`
            : game.status === "settled"
              ? "Played and settled"
              : "Cancelled",
      };
    }

    return NextResponse.json({ group, people, messages, cards });
  } catch (err) {
    return errorResponse(err);
  }
}
