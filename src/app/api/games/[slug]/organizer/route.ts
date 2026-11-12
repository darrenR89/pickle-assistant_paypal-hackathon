import { NextResponse } from "next/server";
import { getGame } from "@/lib/games";
import { toHalfHour, zonedTime } from "@/bot/parse";
import { cancelGame, declineInvite, declineRefund, grantInvite, nudgeUnfinished, refundSpot, resolveLateCancel, settleGame, updateTerms, waitForReplacement } from "@/bot/assistant";
import { retryPayout } from "@/bot/payout";
import { payoutReceiver } from "@/lib/paypal";
import { one, q } from "@/lib/db";
import { errorResponse } from "@/lib/http";
import { tooFarAhead, termsProblem } from "@/lib/limits";

type Body = {
  o?: string;
  action?: "nudge" | "settle" | "cancel" | "terms" | "late" | "invite" | "decline" | "refund" | "keep" | "payout" | "payoutTo";
  gap?: "split" | "cover"; // settle: split a short roster's gap (up to the cap) or cover it
  charge?: boolean; // cancel: after free cancel, charge everyone holding a spot their share
  payoutTo?: string; // Venmo phone or @handle, or PayPal email
  wallet?: "VENMO" | "PAYPAL";
  personId?: string;
  spotId?: string;
  decision?: "charge" | "cover" | "wait";
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
    // Money follow-ups (refunds, the payout and where it goes) still work after the game closes.
    const afterClose = ["refund", "keep", "payout", "payoutTo"].includes(body.action ?? "");
    if (game.status === "draft" && !["terms", "cancel", "payoutTo"].includes(body.action ?? ""))
      return NextResponse.json({ error: "Add the missing details first" }, { status: 409 });
    if (game.status !== "open" && game.status !== "draft" && !(afterClose && (game.status === "settled" || game.status === "cancelled")))
      return NextResponse.json({ error: "This game is already closed" }, { status: 409 });

    switch (body.action) {
      case "nudge":
        return NextResponse.json({ nudged: await nudgeUnfinished(game) });
      case "settle":
        await settleGame(game, { gap: body.gap === "cover" ? "cover" : "split" });
        return NextResponse.json({ ok: true });
      case "cancel":
        try {
          await cancelGame(game, { charge: body.charge === true });
        } catch (err) {
          if (err instanceof Error && !("status" in err)) return NextResponse.json({ error: err.message }, { status: 409 });
          throw err;
        }
        return NextResponse.json({ ok: true });
      case "refund":
        if (!body.spotId) return NextResponse.json({ error: "spotId required" }, { status: 400 });
        try {
          await refundSpot(game, body.spotId);
        } catch (err) {
          if (err instanceof Error && !("status" in err)) return NextResponse.json({ error: err.message }, { status: 409 });
          throw err;
        }
        return NextResponse.json({ ok: true });
      case "keep":
        if (!body.personId) return NextResponse.json({ error: "personId required" }, { status: 400 });
        await declineRefund(game, body.personId);
        return NextResponse.json({ ok: true });
      case "payout":
        await retryPayout(game.id);
        return NextResponse.json({ ok: true });
      case "payoutTo": {
        const wallet = body.wallet === "PAYPAL" ? "PAYPAL" : "VENMO";
        const to = payoutReceiver(body.payoutTo ?? "", wallet);
        if (!to) return NextResponse.json({ error: "Enter a 10-digit phone, a Venmo @handle or a PayPal email" }, { status: 400 });
        await q("update people set payout_to = $2, payout_wallet = $3 where id = $1", [game.organizer_id, (body.payoutTo ?? "").trim().slice(0, 120), to.wallet]);
        return NextResponse.json({ ok: true });
      }
      case "late":
        if (!body.spotId || (body.decision !== "charge" && body.decision !== "cover" && body.decision !== "wait"))
          return NextResponse.json({ error: "spotId and a decision of charge, cover or wait are required" }, { status: 400 });
        if (body.decision === "wait") await waitForReplacement(game, body.spotId);
        else await resolveLateCancel(game, body.spotId, body.decision);
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
          if (tooFarAhead(startsAt, new Date())) return NextResponse.json({ error: "Pick a time in the next 4 weeks. A PayPal hold doesn't last longer than that." }, { status: 400 });
          if (game.status !== "draft" && startsAt.getTime() === new Date(game.starts_at).getTime()) startsAt = undefined;
        }
        const amounts = { capCents: num(body.capCents), totalCents: num(body.totalCents), spots: num(body.spots) };
        const problem = termsProblem(amounts, game.status === "draft");
        if (problem) return NextResponse.json({ error: problem }, { status: 400 });
        try {
          await updateTerms(game, {
            startsAt,
            cancelBy,
            ...amounts,
            address: typeof body.address === "string" ? body.address.slice(0, 200) : undefined,
            place: typeof body.place === "string" ? body.place.slice(0, 80) : undefined,
            courts: typeof body.courts === "string" ? body.courts.slice(0, 40) : undefined,
            level: typeof body.level === "string" ? body.level.slice(0, 20) : undefined,
            kind: oneOf(body.kind, KINDS),
            partners: oneOf(body.partners, PARTNERS),
            setting: oneOf(body.setting, SETTINGS),
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

const KINDS = ["mixed", "womens", "mens", "any", "singles"] as const;
const PARTNERS = ["rotating", "fixed"] as const;
const SETTINGS = ["indoor", "outdoor"] as const;

/** The value if it is one of the allowed options, otherwise undefined. */
function oneOf<T extends string>(v: unknown, options: readonly T[]): T | undefined {
  return options.find((o) => o === v);
}
