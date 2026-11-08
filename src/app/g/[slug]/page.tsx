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
  personById,
  personByToken,
  shortWhen,
  roster,
  whenLabel,
} from "@/lib/games";
import Ring from "../../Ring";
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

  const organizer = await personById(game.organizer_id);
  const dayWord = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: TZ }).format(new Date(game.starts_at));
  const timeWord = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ })
    .format(new Date(game.starts_at))
    .replace(":00", "")
    .replace(" ", "")
    .toLowerCase();
  const statusWord = open ? "Pickleball" : game.status === "settled" ? "Played" : game.status === "settling" ? "Settling up" : "Cancelled";
  const iAmIn = mine?.status === "in";
  const orgData = isOrganizer ? await organizerData(game.id, game) : undefined;

  return (
    <main>
      <header className="pass">
        <div className="pass-top">
          <div className="pass-title">
            <span className="label">
              {isOrganizer ? `Organizer · ${statusWord}` : iAmIn && open ? "Your pass" : `${statusWord} · hosted by ${organizer?.name ?? "the organizer"}`}
            </span>
            <h1>
              {iAmIn && !isOrganizer && open ? (
                <>
                  You&apos;re in,
                  <br />
                  <i>{viewer?.name}</i>
                </>
              ) : (
                <>
                  {dayWord},
                  <br />
                  <i>{timeWord}</i>
                </>
              )}
            </h1>
            <span className="sub">
              {iAmIn && !isOrganizer ? `${dayWord} ${timeWord} · ${game.place}` : game.place}
            </span>
          </div>
          <Ring filled={playing.length} total={game.spots} />
        </div>
        {orgData ? (
          <>
            <div className="tiles">
              <div className="tile">
                <span className="label">Shares in</span>
                <span className="value">
                  {money(orgData.sharesInCents)} <span style={{ fontSize: 16, color: "var(--mint)" }}>of {money(orgData.totalCents)}</span>
                </span>
              </div>
              <div className="tile">
                <span className="label">On hold</span>
                <span className="value">{money(orgData.heldCents)}</span>
              </div>
            </div>
            <div className="bar">
              <div style={{ width: `${Math.min(100, Math.round((orgData.sharesInCents / orgData.totalCents) * 100))}%` }} />
            </div>
          </>
        ) : (
          <div className="tiles">
            <div className="tile">
              <span className="label">{iAmIn ? "On hold" : "Your share"}</span>
              <span className="value">{money(iAmIn ? (mine?.hold_cents ?? 0) : game.share_cents)}</span>
            </div>
            <div className="tile">
              <span className="label">Free cancel until</span>
              <span className="value">{shortWhen(new Date(game.cancel_by))}</span>
            </div>
          </div>
        )}
      </header>

      {orgData ? (
        <OrganizerPanel slug={slug} o={o!} data={orgData} />
      ) : (
        <div className="body">
          {!iAmIn && (
            <section>
              <div className="section-head">
                <span className="label">Who&apos;s in</span>
                <span className="count">
                  {playing.length} of {game.spots}
                </span>
              </div>
              <div className="ledger">
                {playing.map((e) => (
                  <div key={e.id} className="row">
                    <span>{e.name}</span>
                    <span className="amt">{e.person_id === game.organizer_id ? "organizer" : "in"}</span>
                  </div>
                ))}
              </div>
              {game.spots - playing.length > 0 && (
                <p className="muted small" style={{ margin: "10px 0 0" }}>
                  {game.spots - playing.length} spot{game.spots - playing.length === 1 ? "" : "s"} open
                </p>
              )}
            </section>
          )}
          {open && (
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
              startsAtIso={new Date(game.starts_at).toISOString()}
              place={game.place}
            />
          )}
        </div>
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
    shareCents: game.share_cents,
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
