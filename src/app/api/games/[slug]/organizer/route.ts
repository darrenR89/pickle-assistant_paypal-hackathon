import { NextResponse } from "next/server";
import { getGame } from "@/lib/games";
import { zonedTime } from "@/bot/parse";
import { cancelGame, nudgeUnfinished, resolveLateCancel, settleGame, updateTerms } from "@/bot/assistant";
import { errorResponse } from "@/lib/http";

type Body = {
  o?: string;
  action?: "nudge" | "settle" | "cancel" | "terms" | "late";
  spotId?: string;
  decision?: "charge" | "cover";
  cancelBy?: string; // "YYYY-MM-DDTHH:mm" in the game's time zone
  capCents?: number;
  totalCents?: number;
  spots?: number;
};

// Organizer-only actions. The organizer token in their private link is the key.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const body = (await req.json().catch(() => ({}))) as Body;
    const game = await getGame(slug);
    if (!game || !body.o || body.o !== game.organizer_token) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (game.status !== "open") return NextResponse.json({ error: "This game is already closed" }, { status: 409 });

    switch (body.action) {
      case "nudge":
        return NextResponse.json({ nudged: await nudgeUnfinished(game) });
      case "settle":
        await settleGame(game);
        return NextResponse.json({ ok: true });
      case "cancel":
        await cancelGame(game);
        return NextResponse.json({ ok: true });
      case "late":
        if (!body.spotId || !body.decision) return NextResponse.json({ error: "spotId and decision required" }, { status: 400 });
        await resolveLateCancel(game, body.spotId, body.decision);
        return NextResponse.json({ ok: true });
      case "terms": {
        let cancelBy: Date | undefined;
        if (body.cancelBy) {
          const m = body.cancelBy.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
          if (!m) return NextResponse.json({ error: "Bad cancel-by time" }, { status: 400 });
          cancelBy = zonedTime(+m[1], +m[2], +m[3], +m[4], +m[5]);
        }
        try {
          await updateTerms(game, {
            cancelBy,
            capCents: num(body.capCents),
            totalCents: num(body.totalCents),
            spots: num(body.spots),
          });
        } catch (err) {
          return NextResponse.json({ error: (err as Error).message }, { status: 409 });
        }
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    return errorResponse(err);
  }
}

function num(v: unknown) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined;
}
