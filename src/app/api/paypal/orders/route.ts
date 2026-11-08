import { NextResponse } from "next/server";
import { newId, newToken, one, q } from "@/lib/db";
import { type Person, getGame, holdCents, inPlayers, personByToken, roster, whenLabel } from "@/lib/games";
import { createHoldOrder } from "@/lib/paypal";
import { errorResponse } from "@/lib/http";

// Step 1 of joining: create an AUTHORIZE order for this person's hold.
// The server decides the amount and remembers which game and person the order is for.
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { slug?: string; p?: string; name?: string; phone?: string };
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

    const entries = await roster(game.id);
    if (entries.some((e) => e.person_id === person!.id && e.status === "in")) {
      return NextResponse.json({ error: "You're already in" }, { status: 409 });
    }
    if (inPlayers(entries).length >= game.spots) return NextResponse.json({ error: "The game is full" }, { status: 409 });

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

function normalizePhone(raw?: string) {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : undefined;
}
