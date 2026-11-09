import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { q } from "@/lib/db";
import {
  TZ,
  getGame,
  holdCents,
  inPlayers,
  isBeforeCancelBy,
  mapsUrl,
  money,
  personById,
  personByToken,
  roster,
  whenLabel,
} from "@/lib/games";
import Icon from "../../Icon";
import WhoIsIn from "./WhoIsIn";
import JoinPanel from "./JoinPanel";
import JoinBar from "./JoinBar";
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

  const organizer = await personById(game.organizer_id);
  const starts = new Date(game.starts_at);
  const dayLabel = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: TZ })
    .format(starts)
    .replace(",", "");
  const [clock, meridiem] = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ })
    .format(starts)
    .split(" ");
  const statusWord = open ? null : game.status === "settled" ? "Played" : game.status === "settling" ? "Settling up" : "Cancelled";
  const iAmIn = mine?.status === "in";
  const whoNames = playing.map((e) => ({ name: e.name, organizer: e.person_id === game.organizer_id }));
  const orgData = isOrganizer ? await organizerData(game.id, game) : undefined;
  const host = organizer?.name ? `${organizer.name}’s game` : "Pickleball";
  const kicker = isOrganizer
    ? `Your game · ${statusWord ?? dayLabel}`
    : iAmIn && open
      ? `You’re in, ${viewer?.name} · ${dayLabel}`
      : `${statusWord ? `${statusWord} · ` : ""}${host} · ${dayLabel}`;
  const left = Math.max(0, game.spots - playing.length);
  const showJoinBar = open && !orgData && !iAmIn && !full && viewer?.id !== game.organizer_id;

  return (
    <main>
      <header className="hero">
        <span className="kicker">{kicker}</span>
        <h1 className="big-time">
          {clock}
          <small>{meridiem}</small>
        </h1>
        {orgData && (
          <div className="hero-stats">
            <div className="hero-stat">
              <span className="label">Shares in</span>
              <span className="value">
                {money(orgData.sharesInCents)} <small>of {money(orgData.totalCents)}</small>
              </span>
            </div>
            <div className="hero-stat">
              <span className="label">On hold now</span>
              <span className="value">{money(orgData.heldCents)}</span>
            </div>
          </div>
        )}
        <WhoIsIn names={whoNames} spots={game.spots} />
      </header>

      <div className="body">
        <div className="rows">
          <div className="info-row">
            <Icon name="pin" />
            <div>
              <span className="info-main">{game.address ?? game.place}</span>
              {game.address && <span className="info-sub">{game.place}</span>}
              <a className="maps-link" href={mapsUrl(game)} target="_blank" rel="noreferrer">
                Open in Maps <Icon name="ext" size={18} />
              </a>
            </div>
          </div>
          {!orgData && (
            <div className="info-row">
              <Icon name="card" />
              <div>
                <span className="info-main">
                  {iAmIn ? `${money(mine?.hold_cents ?? 0)} on hold` : `${money(game.share_cents)} is your share`}
                </span>
                <span className="info-sub">
                  {iAmIn
                    ? `Your share is ${money(game.share_cents)}. Charged after the game.`
                    : `We hold ${money(holdCents(game))} now and charge after the game`}
                </span>
              </div>
            </div>
          )}
          <div className="info-row">
            <Icon name="undo" />
            <div>
              <span className="info-main">Free cancel until {whenLabel(game.cancel_by)}</span>
              <span className="info-sub">{orgData ? "Players get their hold back in full" : "Your hold is released in full"}</span>
            </div>
          </div>
        </div>

        {orgData ? (
          <OrganizerPanel slug={slug} o={o!} data={orgData} />
        ) : (
          open && (
            <JoinPanel
              slug={slug}
              clientId={process.env.PAYPAL_CLIENT_ID ?? ""}
              p={viewer?.token}
              viewerName={viewer?.name}
              isIn={iAmIn}
              isOrganizer={viewer?.id === game.organizer_id}
              holdCents={mine?.hold_cents ?? holdCents(game)}
              shareCents={game.share_cents}
              capCents={game.cap_cents}
              full={full}
              beforeCancelBy={isBeforeCancelBy(game)}
              cancelByLabel={whenLabel(game.cancel_by)}
              startsAtIso={starts.toISOString()}
              place={game.address ? `${game.place}, ${game.address}` : game.place}
            />
          )
        )}
      </div>

      {showJoinBar && <JoinBar price={money(game.share_cents)} left={left} />}
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
    shareCents: game.share_cents,
    sharesInCents: Math.min(sharesIn, game.total_cents),
    heldCents: held,
    spots: game.spots,
    capCents: game.cap_cents,
    cancelByLocal: cancelLocal,
    address: game.address,
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
