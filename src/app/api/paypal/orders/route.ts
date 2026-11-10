import { NextResponse } from "next/server";
import { newId, newToken, one, q } from "@/lib/db";
import { type Person, getGame, holdCents, inPlayers, isInvited, personByToken, roster, whenLabel } from "@/lib/games";
import { createHoldOrder } from "@/lib/paypal";
import { errorResponse } from "@/lib/http";
import { normalizePhone } from "@/lib/phone";
import { spotOfferFor } from "@/bot/assistant";

// Step 1 of joining: create an AUTHORIZE order for this person's hold.
// The server decides the amount and remembers which game and person the order is for.
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { slug?: string; p?: string; name?: string; phone?: string; texts?: boolean };
    const game = body.slug ? await getGame(body.slug) : undefined;
    if (!game || game.status !== "open") return NextResponse.json({ error: "This game isn't open" }, { status: 404 });

    let person: Person | undefined = await personByToken(body.p);
    if (!person) {
      const name = body.name?.trim().slice(0, 40);
      const phone = normalizePhone(body.phone);
      if (!name || !phone) return NextResponse.json({ error: "Add your name and phone number" }, { status: 400 });
      person =
        (await one<Person>("select * from people where phone = $1", [phone])) ??
        (await one<Person>(
          "insert into people (id, name, phone, token) values ($1, $2, $3, $4) returning *",
          [newId("per"), name, phone, newToken()],
        ));
      await q("insert into group_members (group_id, person_id) values ($1, $2) on conflict do nothing", [
        game.group_id,
        person!.id,
      ]);
    }

    // Private texts are opt-in (each new 1:1 chat costs money).
    if (typeof body.texts === "boolean") await q("update people set texts_opt_in = $2 where id = $1", [person!.id, body.texts]);

    const entries = await roster(game.id);
    if (entries.some((e) => e.person_id === person!.id && e.status === "in")) {
      return NextResponse.json({ error: "You're already in" }, { status: 409 });
    }
    const offered = await spotOfferFor(game.id, person!.id);
    if (!offered && !(await isInvited(game, person!.id))) {
      return NextResponse.json({ error: "This game is invite-only. Ask the organizer to add you." }, { status: 403 });
    }
    // A full game can still be joined by someone who was handed a spot.
    if (inPlayers(entries).length >= game.spots && !offered) {
      return NextResponse.json({ error: "The game is full" }, { status: 409 });
    }

    const amount = holdCents(game);
    const order = await createHoldOrder({
      amountCents: amount,
      description: `Pickleball ${whenLabel(game.starts_at)} · ${game.place} (hold)`,
      referenceId: game.slug,
      requestId: crypto.randomUUID(),
    });
    await q("insert into pending_orders (order_id, game_id, person_id, hold_cents) values ($1, $2, $3, $4)", [
      order.id,
      game.id,
      person!.id,
      amount,
    ]);
    return NextResponse.json({ id: order.id, p: person!.token });
  } catch (err) {
    return errorResponse(err);
  }
}
