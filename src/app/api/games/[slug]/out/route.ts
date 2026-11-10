import { NextResponse } from "next/server";
import { getGame, personByToken } from "@/lib/games";
import { playerOut } from "@/bot/assistant";
import { errorResponse } from "@/lib/http";

// "Can't make it" on the game page. Before free cancel the hold is released; after it, the organizer decides.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const body = (await req.json().catch(() => ({}))) as { p?: string };
    const game = await getGame(slug);
    const person = await personByToken(body.p);
    if (!game || !person) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (game.status !== "open") return NextResponse.json({ error: "This game is already closed" }, { status: 409 });
    if (person.id === game.organizer_id) return NextResponse.json({ error: "You're the organizer. To call off the game, use your organizer link." }, { status: 409 });
    await playerOut(game, person.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
