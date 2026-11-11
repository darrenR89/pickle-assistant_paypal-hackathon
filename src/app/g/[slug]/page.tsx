import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { q } from "@/lib/db";
import {
  type Game,
  TZ,
  cancelRule,
  getGame,
  holdCents,
  inPlayers,
  inviteeNames,
  isBeforeCancelBy,
  isInvited,
  mapsUrl,
  money,
  personById,
  personByToken,
  roster,
  whenLabel,
} from "@/lib/games";
import { KIND_LABEL } from "@/bot/details";
import { chargedLateCancels, shortfall } from "@/bot/assistant";
import { describeReceiver, organizerPayoutTo } from "@/bot/payout";
import ModalFocus from "@/app/ModalFocus";
import GameScreen from "./GameScreen";

// Read env and the live roster at request time.
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ p?: string; o?: string; demo?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const game = await getGame((await params).slug);
  if (!game) return {};
  const playing = inPlayers(await roster(game.id));
  const kind = game.kind ? `${KIND_LABEL[game.kind]} · ` : "";
  const title = `${kind}${whenLabel(game.starts_at)} · ${game.place}`;
  const description = `${playing.length} of ${game.spots} in · ${money(game.share_cents)} each, ${cancelRule(game)}`;
  // Open Graph tags drive the rich link preview in Messages and WhatsApp. No private money here.
  return { title, description, openGraph: { title, description } };
}

const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, ...o }).format(d);

function factsLine(game: Game) {
  const start = new Date(game.starts_at);
  const t = (d: Date) => fmt(d, { hour: "numeric", minute: "2-digit" }).replace(":00", "").toLowerCase();
  const parts: string[] = [];
  if (game.ends_at) {
    const end = new Date(game.ends_at);
    const sameHalf = t(start).slice(-2) === t(end).slice(-2);
    parts.push(`${sameHalf ? t(start).replace(/ ?[ap]m$/, "") : t(start)}–${t(end)}`);
  }
  if (game.level) parts.push(/^\d/.test(game.level) ? `Level ${game.level}` : game.level);
  if (game.setting) parts.push(game.setting === "indoor" ? "Indoor" : "Outdoor");
  if (game.kind && game.kind !== "singles") parts.push("Round robin");
  return parts.join(" · ");
}

export type MeStatus = "none" | "in" | "out" | "late" | "charged" | "covered" | "paid" | "refunded";

export default async function GamePage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { p, o, demo } = await searchParams;
  const game = await getGame(slug);
  if (!game) notFound();
  return (
    <>
      <GameScreen view={await buildView(game, slug, p, o)} demo={demo && /^grp_[a-f0-9]+$/.test(demo) ? demo : null} />
      <ModalFocus />
    </>
  );
}

async function buildView(game: Game, slug: string, p?: string, o?: string) {
  const entries = await roster(game.id);
  const playing = inPlayers(entries);
  const isOrganizer = Boolean(o) && o === game.organizer_token;
  const viewer = await personByToken(p);
  const mine = viewer ? entries.find((e) => e.person_id === viewer.id) : undefined;
  const host = await personById(game.organizer_id);
  const start = new Date(game.starts_at);
  const [clock, meridiem] = fmt(start, { hour: "numeric", minute: "2-digit" }).split(" ");

  let me: MeStatus = "none";
  if (mine?.status === "in") me = game.status === "settled" && mine.hold_status === "captured" ? "paid" : "in";
  else if (mine?.late_cancel === "pending") me = "late";
  else if (mine?.late_cancel === "charged") me = "charged";
  else if (mine?.late_cancel === "covered") me = "covered";
  else if (mine?.status === "out") me = "out";
  if (mine?.hold_status === "captured" && (mine.captured_cents ?? 0) > 0 && mine.refunded_cents >= (mine.captured_cents ?? 0)) me = "refunded";

  const view = {
    slug,
    p: viewer?.token ?? null,
    o: isOrganizer ? o! : null,
    clientId: process.env.PAYPAL_CLIENT_ID ?? "",
    status: game.status,
    over: Date.now() > start.getTime(),
    clock,
    meridiem,
    dateLabel: fmt(start, { weekday: "short", month: "short", day: "numeric" }),
    kindLabel: game.kind ? KIND_LABEL[game.kind] : null,
    doubles: game.kind !== "singles",
    partners: game.partners,
    facts: factsLine(game),
    place: game.place,
    courts: game.courts,
    address: game.address,
    mapsUrl: mapsUrl(game),
    calendar: { startIso: start.toISOString(), endIso: (game.ends_at ? new Date(game.ends_at) : new Date(start.getTime() + 2 * 3600_000)).toISOString(), where: [game.place, game.courts, game.address].filter(Boolean).join(", ") },
    spots: game.spots,
    players: playing.map((e) => ({ name: e.name, host: e.person_id === game.organizer_id, me: e.person_id === viewer?.id })),
    lateNames: entries.filter((e) => e.late_cancel === "pending").map((e) => e.name),
    shareCents: game.share_cents,
    capCents: game.cap_cents,
    holdCents: holdCents(game),
    cancelByLabel: whenLabel(game.cancel_by),
    beforeCancelBy: isBeforeCancelBy(game),
    hostName: host?.name ?? "The organizer",
    inviteOnly: game.invite_only,
    invited: game.invite_only ? await inviteeNames(game.id) : [],
    canJoin: viewer ? await isInvited(game, viewer.id) : !game.invite_only,
    asked: viewer ? !!(await q("select 1 from intents where game_id = $1 and person_id = $2 and kind = 'request'", [game.id, viewer.id])).length : false,
    viewerName: viewer?.name ?? null,
    viewerIsHost: viewer?.id === game.organizer_id,
    me,
    myHoldCents: mine?.hold_cents ?? 0,
    myChargedCents: mine?.captured_cents ?? 0,
    myRefundedCents: mine?.refunded_cents ?? 0,
    refundAsked: viewer ? !!(await q("select 1 from intents where game_id = $1 and person_id = $2 and kind = 'refund'", [game.id, viewer.id])).length : false,
    organizer: isOrganizer ? await organizerData(game) : null,
  };
  return view;
}

async function organizerData(game: Game) {
  const entries = await roster(game.id);
  const playing = inPlayers(entries);
  const held = entries.filter((e) => e.hold_status === "held").reduce((s, e) => s + (e.hold_cents ?? 0), 0);
  const collected = entries.filter((e) => e.hold_status === "captured").reduce((s, e) => s + (e.captured_cents ?? 0) - e.refunded_cents, 0);
  const host = await personById(game.organizer_id);
  const payTo = host ? organizerPayoutTo(host) : null;
  const { gap, extraEach } = shortfall(game, playing.length, chargedLateCancels(entries));
  const waiting = await q<{ id: string; name: string; kind: string }>(
    "select p.id, p.name, i.kind from intents i join people p on p.id = i.person_id where i.game_id = $1 order by i.said_at",
    [game.id],
  );
  const cancelLocal = fmt(new Date(game.cancel_by), { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const [d, t] = cancelLocal.split(", ");
  const [mm, dd, yyyy] = d.split("/");
  const startLocal = fmt(new Date(game.starts_at), { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const [sd, st] = startLocal.split(", ");
  const [smm, sdd, syyyy] = sd.split("/");
  return {
    needs: game.needs ?? [],
    startDate: `${syyyy}-${smm}-${sdd}`,
    startTime: st,
    totalCents: game.total_cents,
    sharesInCents: Math.min(playing.length * game.share_cents, game.total_cents),
    heldCents: held,
    collectedCents: collected,
    cancelByLocal: `${yyyy}-${mm}-${dd}T${t}`,
    kind: game.kind,
    level: game.level ?? "",
    setting: game.setting,
    gapCents: gap,
    splitEachCents: extraEach,
    closeChoice: game.close_choice,
    payout: {
      status: game.payout_status,
      cents: game.payout_cents ?? 0,
      error: game.payout_error,
      to: payTo ? describeReceiver(payTo) : null,
      raw: host?.payout_to ?? host?.phone ?? "",
      wallet: host?.payout_wallet ?? "VENMO",
    },
    players: entries
      .filter((e) => e.status === "in" || e.late_cancel === "pending" || e.late_cancel === "charged")
      .map((e) => ({
        id: e.id,
        name: e.name,
        isHost: e.person_id === game.organizer_id,
        late: e.late_cancel === "pending",
        holdStatus: e.hold_status,
        holdCents: e.hold_cents ?? 0,
        capturedCents: e.captured_cents ?? 0,
        refundedCents: e.refunded_cents,
        lateCharged: e.late_cancel === "charged",
        refundAsked: waiting.some((w) => w.id === e.person_id && w.kind === "refund"),
        personId: e.person_id,
      })),
    waiting: waiting.filter((w) => w.kind !== "refund").map((w) => ({ id: w.id, name: w.name, kind: w.kind })),
  };
}

export type ViewData = Awaited<ReturnType<typeof buildView>>;
export type OrganizerData = Awaited<ReturnType<typeof organizerData>>;
