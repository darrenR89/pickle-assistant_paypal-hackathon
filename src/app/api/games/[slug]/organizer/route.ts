import { NextResponse } from "next/server";
import { getGame } from "@/lib/games";
import { toHalfHour, zonedTime } from "@/bot/parse";
import { cancelGame, declineInvite, grantInvite, nudgeUnfinished, resolveLateCancel, settleGame, updateTerms } from "@/bot/assistant";
import { one } from "@/lib/db";
import { errorResponse } from "@/lib/http";

type Body = {
  o?: string;
  action?: "nudge" | "settle" | "cancel" | "terms" | "late" | "invite" | "decline";
  personId?: string;
  spotId?: string;
  decision?: "charge" | "cover";
  cancelBy?: string; // "YYYY-MM-DDTHH:mm" in the game's time zone
  startsAt?: string; // same format
  capCents?: number;
  totalCents?: number;
  spots?: number;
  address?: string;
  place?: string;
  courts?: string;
  kind?: string;
  partners?: string;
  level?: string;
  setting?: string;
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
    if (game.status === "draft" && !["terms", "cancel"].includes(body.action ?? ""))
      return NextResponse.json({ error: "Add the missing details first" }, { status: 409 });
    if (game.status !== "open" && game.status !== "draft") return NextResponse.json({ error: "This game is already closed" }, { status: 409 });

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
      case "invite":
      case "decline": {
        const member = body.personId
          ? await one("select 1 from group_members where group_id = $1 and person_id = $2", [game.group_id, body.personId])
          : null;
        if (!member) return NextResponse.json({ error: "Unknown person" }, { status: 400 });
        if (body.action === "invite") await grantInvite(game, body.personId!);
        else await declineInvite(game, body.personId!);
        return NextResponse.json({ ok: true });
      }
      case "terms": {
        let cancelBy: Date | undefined;
        if (body.cancelBy) {
          const m = body.cancelBy.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
          if (!m) return NextResponse.json({ error: "Bad cancel-by time" }, { status: 400 });
          cancelBy = zonedTime(+m[1], +m[2], +m[3], +m[4], +m[5]);
        }
        let startsAt: Date | undefined;
        if (body.startsAt) {
          const m = body.startsAt.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
          if (!m) return NextResponse.json({ error: "Bad start time" }, { status: 400 });
          startsAt = toHalfHour(zonedTime(+m[1], +m[2], +m[3], +m[4], +m[5]));
          if (startsAt.getTime() < Date.now()) return NextResponse.json({ error: "That time has already passed" }, { status: 400 });
          if (game.status !== "draft" && startsAt.getTime() === new Date(game.starts_at).getTime()) startsAt = undefined;
        }
        try {
          await updateTerms(game, {
            startsAt,
            cancelBy,
            capCents: num(body.capCents),
            totalCents: num(body.totalCents),
            spots: num(body.spots),
            address: typeof body.address === "string" ? body.address.slice(0, 200) : undefined,
            place: typeof body.place === "string" ? body.place.slice(0, 80) : undefined,
            courts: typeof body.courts === "string" ? body.courts.slice(0, 40) : undefined,
            level: typeof body.level === "string" ? body.level.slice(0, 20) : undefined,
            kind: ["mixed", "womens", "mens", "any", "singles"].includes(body.kind ?? "") ? (body.kind as never) : undefined,
            partners: ["rotating", "fixed"].includes(body.partners ?? "") ? (body.partners as never) : undefined,
            setting: ["indoor", "outdoor"].includes(body.setting ?? "") ? (body.setting as never) : undefined,
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
