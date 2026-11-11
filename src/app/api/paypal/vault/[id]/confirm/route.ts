import { NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { type Game, inPlayers, roster } from "@/lib/games";
import { holdBlocked } from "@/lib/limits";
import { createPaymentToken } from "@/lib/paypal";
import { spotOfferFor } from "@/bot/assistant";
import { playerSaved } from "@/bot/delayed";
import { errorResponse } from "@/lib/http";

// Step 2 of joining a far-off game: the player approved saving their PayPal. Swap the approved
// setup token for a payment token (kept on the server only) and add them. Nothing is held yet.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const pending = await one<{ order_id: string; game_id: string; person_id: string }>(
      "select * from pending_orders where order_id = $1 and kind = 'save'",
      [id],
    );
    if (!pending) return NextResponse.json({ error: "Unknown approval" }, { status: 404 });
    const game = await one<Game>("select * from games where id = $1", [pending.game_id]);
    if (!game) return NextResponse.json({ error: "Unknown game" }, { status: 404 });

    const entries = await roster(game.id);
    const mine = entries.find((e) => e.person_id === pending.person_id && e.status === "in");
    // Already processed (double click, retry).
    if (mine && mine.hold_status !== "failed") return NextResponse.json({ saved: true });

    // The game can fill up or close while the player is in PayPal. Stop before anything is saved.
    const offered = !!(await spotOfferFor(game.id, pending.person_id));
    const blocked = holdBlocked(game, inPlayers(entries).length, offered || !!mine);
    if (blocked) {
      await q("delete from pending_orders where order_id = $1", [id]);
      return NextResponse.json({ error: blocked.replace("no hold was placed", "nothing was saved") }, { status: 409 });
    }

    const saved = await createPaymentToken(id);
    await playerSaved(game, pending.person_id, saved.id);
    await q("delete from pending_orders where order_id = $1", [id]);
    return NextResponse.json({ saved: true });
  } catch (err) {
    return errorResponse(err);
  }
}
