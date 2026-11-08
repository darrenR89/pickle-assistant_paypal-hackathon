import { NextResponse } from "next/server";
import { getGame } from "@/lib/games";
import { createHoldOrder } from "@/lib/paypal";
import { errorResponse } from "@/lib/http";

// Step 1 of a hold: create an AUTHORIZE order for one share of a game.
export async function POST(req: Request) {
  try {
    const { slug } = (await req.json().catch(() => ({}))) as { slug?: string };
    const game = slug ? getGame(slug) : undefined;
    if (!game) return NextResponse.json({ error: "Unknown game" }, { status: 404 });

    const order = await createHoldOrder({
      amountCents: game.shareCents,
      description: `${game.title} · ${game.when} · ${game.where}`,
      referenceId: game.slug,
      requestId: crypto.randomUUID(),
    });
    return NextResponse.json({ id: order.id });
  } catch (err) {
    return errorResponse(err);
  }
}
