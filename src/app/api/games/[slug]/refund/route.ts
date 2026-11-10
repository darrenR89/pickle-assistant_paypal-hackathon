import { NextResponse } from "next/server";
import { getGame, personByToken } from "@/lib/games";
import { requestRefund } from "@/bot/assistant";
import { errorResponse } from "@/lib/http";

// "I did show up": a charged player asks the organizer, privately, for their money back.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const body = (await req.json().catch(() => ({}))) as { p?: string };
    const game = await getGame(slug);
    const person = await personByToken(body.p);
    if (!game || !person) return NextResponse.json({ error: "Not found" }, { status: 404 });
    try {
      await requestRefund(game, person.id);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
