import { NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { type Game, inPlayers, money, openGameForGroup, roster, shortWhen, whenLabel } from "@/lib/games";
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
    const group = await one<{ id: string; name: string; playground: boolean }>("select id, name, playground from groups where id = $1", [id]);
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
        when: game.status === "draft" && game.needs?.includes("when") ? "Draft" : shortWhen(new Date(game.starts_at)),
        spots: `${playing.length}/${game.spots}`,
        title: game.status === "draft" ? `${game.place || "New game"} · details needed` : `${whenLabel(game.starts_at)} · ${game.place}`,
        subtitle:
          game.status === "draft"
            ? "Not posted yet · organizer view"
            : game.status === "open"
            ? `${playing.length} of ${game.spots} in · ${money(game.share_cents)} each`
            : game.status === "settled"
              ? "Played and settled"
              : "Cancelled",
      };
    }

    // Demo groups also get the current game's links, so testers can open any view directly.
    let game: unknown = null;
    if (group.playground) {
      const g = await openGameForGroup(id) ?? (await one<Game>("select * from games where group_id = $1 order by created_at desc limit 1", [id]));
      if (g) {
        const entries = await roster(g.id);
        game = {
          slug: g.slug,
          organizerToken: g.organizer_token,
          organizerId: g.organizer_id,
          status: g.status,
          when: whenLabel(g.starts_at),
          inviteOnly: g.invite_only,
          spots: g.spots,
          inIds: inPlayers(entries).map((e) => e.person_id),
        };
      }
    }

    return NextResponse.json({ group, people, messages, cards, game });
  } catch (err) {
    return errorResponse(err);
  }
}
