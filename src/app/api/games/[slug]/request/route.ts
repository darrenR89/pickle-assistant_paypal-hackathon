import { NextResponse } from "next/server";
import { getGame, isInvited, personByToken } from "@/lib/games";
import { requestInvite } from "@/bot/assistant";
import { errorResponse } from "@/lib/http";

// Someone on the game page asks to join an invite-only game. The organizer is asked privately.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const body = (await req.json().catch(() => ({}))) as { p?: string };
    const game = await getGame(slug);
    const person = await personByToken(body.p);
    if (!game || game.status !== "open" || !person) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (await isInvited(game, person.id)) return NextResponse.json({ ok: true, invited: true });
    await requestInvite(game, person.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
