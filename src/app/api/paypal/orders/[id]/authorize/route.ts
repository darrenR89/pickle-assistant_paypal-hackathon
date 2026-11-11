import { NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { type Game, inPlayers, roster } from "@/lib/games";
import { holdBlocked } from "@/lib/limits";
import { authorizeOrder, firstAuthorization } from "@/lib/paypal";
import { playerJoined, spotOfferFor } from "@/bot/assistant";
import { errorResponse } from "@/lib/http";

// Step 2 of joining: the player approved in PayPal or Venmo. Place the hold and add them.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const pending = await one<{ order_id: string; game_id: string; person_id: string; hold_cents: number }>(
      "select * from pending_orders where order_id = $1 and kind = 'order'",
      [id],
    );
    if (!pending) return NextResponse.json({ error: "Unknown order" }, { status: 404 });
    const game = await one<Game>("select * from games where id = $1", [pending.game_id]);
    if (!game) return NextResponse.json({ error: "Unknown game" }, { status: 404 });

    // Already processed (double click, retry): return the existing hold.
    const entries = await roster(game.id);
    const existing = entries.find((e) => e.order_id === id && e.status === "in");
    if (existing) return NextResponse.json({ authorizationId: existing.authorization_id, status: "CREATED" });

    // The game can fill up or close while the player is in PayPal. Stop before the hold exists:
    // an approved order that is never authorized takes nothing from the player.
    const offered = !!(await spotOfferFor(game.id, pending.person_id));
    // Someone approving again after a refused later hold already has their spot.
    const retrying = entries.some((e) => e.person_id === pending.person_id && e.status === "in" && e.hold_status === "failed");
    const blocked = holdBlocked(game, inPlayers(entries).length, offered || retrying);
    if (blocked) {
      await q("delete from pending_orders where order_id = $1", [id]);
      return NextResponse.json({ error: blocked }, { status: 409 });
    }

    const order = await authorizeOrder(id);
    const auth = firstAuthorization(order);
    if (!auth) return NextResponse.json({ error: "No authorization returned" }, { status: 502 });

    await playerJoined(game, pending.person_id, auth.id, pending.hold_cents, id);
    await q("delete from pending_orders where order_id = $1", [id]);
    return NextResponse.json({ authorizationId: auth.id, status: auth.status, expiresAt: auth.expiration_time });
  } catch (err) {
    return errorResponse(err);
  }
}
