import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { q } from "@/lib/db";
import {
  TZ,
  getGame,
  holdCents,
  inPlayers,
  isBeforeCancelBy,
  money,
  personByToken,
  roster,
  whenLabel,
} from "@/lib/games";
import JoinPanel from "./JoinPanel";
import OrganizerPanel from "./OrganizerPanel";

// Read env and the live roster at request time.
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ p?: string; o?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const game = await getGame((await params).slug);
  if (!game) return {};
  const playing = inPlayers(await roster(game.id));
  const title = `${whenLabel(game.starts_at)} · ${game.place}`;
  const description = `${playing.length} of ${game.spots} in · ${money(game.share_cents)} each, free cancel until ${whenLabel(game.cancel_by)}`;
  // Open Graph tags drive the rich link preview in Messages and WhatsApp. No private money here.
  return { title, description, openGraph: { title, description } };
}

export default async function GamePage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { p, o } = await searchParams;
  const game = await getGame(slug);
  if (!game) notFound();

  const entries = await roster(game.id);
  const playing = inPlayers(entries);
  const isOrganizer = Boolean(o) && o === game.organizer_token;
  const viewer = await personByToken(p);
  const mine = viewer ? entries.find((e) => e.person_id === viewer.id) : undefined;
  const full = playing.length >= game.spots;
  const open = game.status === "open";

  return (
    <main>
      <p className="eyebrow">{open ? "Pickleball" : game.status === "settled" ? "Played" : game.status === "settling" ? "Settling up" : "Cancelled"}</p>
      <h1>{whenLabel(game.starts_at)}</h1>
      <p className="muted">{game.place}</p>

      <div className="card">
        <div className="row">
          <span>Who&apos;s in</span>
          <span className="status">
            {playing.length} of {game.spots}
          </span>
        </div>
        <div className="chips">
          {playing.map((e) => (
            <span key={e.id} className="chip">
              {e.name}
              {e.person_id === game.organizer_id ? " · organizer" : ""}
            </span>
          ))}
          {Array.from({ length: Math.max(0, game.spots - playing.length) }).map((_, i) => (
            <span key={`open-${i}`} className="chip open">
              open
            </span>
          ))}
        </div>
        <div className="row">
          <span>Each</span>
          <span>{money(game.share_cents)}</span>
        </div>
        <div className="row">
          <span>Free cancel until</span>
          <span>{whenLabel(game.cancel_by)}</span>
        </div>
      </div>

      {isOrganizer ? (
        <OrganizerPanel slug={slug} o={o!} data={await organizerData(game.id, game)} />
      ) : (
        open && (
          <JoinPanel
            slug={slug}
            clientId={process.env.PAYPAL_CLIENT_ID ?? ""}
            p={viewer?.token}
            viewerName={viewer?.name}
            isIn={mine?.status === "in"}
            isOrganizer={viewer?.id === game.organizer_id}
            holdCents={mine?.hold_cents ?? holdCents(game)}
            shareCents={game.share_cents}
            capCents={game.cap_cents}
            full={full}
            beforeCancelBy={isBeforeCancelBy(game)}
            cancelByLabel={whenLabel(game.cancel_by)}
          />
        )
      )}
    </main>
  );
}

async function organizerData(gameId: string, game: Awaited<ReturnType<typeof getGame>> & object) {
  const entries = await roster(gameId);
  const playing = inPlayers(entries);
  const held = entries.filter((e) => e.hold_status === "held").reduce((s, e) => s + (e.hold_cents ?? 0), 0);
  const sharesIn = playing.length * game.share_cents;
  const events = await q<{ kind: string; name: string | null; created_at: Date }>(
    `select e.kind, p.name, e.created_at from events e left join people p on p.id = e.person_id
     where e.game_id = $1 order by e.id desc limit 20`,
    [gameId],
  );
  const waiting = await q<{ name: string }>(
    "select p.name from intents i join people p on p.id = i.person_id where i.game_id = $1",
    [gameId],
  );
  const cancelLocal = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(new Date(game.cancel_by))
    .replace(" ", "T");
  return {
    status: game.status,
    totalCents: game.total_cents,
    sharesInCents: Math.min(sharesIn, game.total_cents),
    heldCents: held,
    spots: game.spots,
    capCents: game.cap_cents,
    cancelByLocal: cancelLocal,
    organizerId: game.organizer_id,
    players: entries.map((e) => ({
      id: e.id,
      name: e.name,
      status: e.status,
      holdStatus: e.hold_status,
      holdCents: e.hold_cents,
      capturedCents: e.captured_cents,
      lateCancel: e.late_cancel,
      isOrganizer: e.person_id === game.organizer_id,
    })),
    waiting: waiting.map((w) => w.name),
    activity: events.map((e) => ({ kind: e.kind, name: e.name, at: new Date(e.created_at).toISOString() })),
  };
}

export type OrganizerData = Awaited<ReturnType<typeof organizerData>>;
