import { one, q } from "./db";

export const TZ = "America/Los_Angeles";

export type Game = {
  id: string;
  slug: string;
  group_id: string;
  organizer_id: string;
  starts_at: Date;
  place: string;
  /** Street address, when the organizer gave one. The Maps link falls back to the place name. */
  address: string | null;
  kind: "mixed" | "womens" | "mens" | "any" | "singles" | null;
  partners: "rotating" | "fixed" | null;
  level: string | null;
  ends_at: Date | null;
  setting: "indoor" | "outdoor" | null;
  /** Court label, e.g. "Courts 3–4". `place` is the venue name. */
  courts: string | null;
  invite_only: boolean;
  needs: string[];
  spots: number;
  total_cents: number;
  share_cents: number;
  cap_cents: number;
  cancel_by: Date;
  organizer_pays: boolean;
  organizer_token: string;
  status: "draft" | "open" | "settling" | "cancelled" | "settled";
  cancel_reminder_sent: boolean;
  gameday_reminder_sent: boolean;
  created_at: Date;
};

export type Person = { id: string; name: string; phone: string; token: string };

export type Spot = {
  id: string;
  game_id: string;
  person_id: string;
  status: "in" | "out";
  order_id: string | null;
  authorization_id: string | null;
  hold_cents: number | null;
  hold_status: "none" | "held" | "voided" | "captured";
  captured_cents: number | null;
  late_cancel: null | "pending" | "charged" | "covered";
  authorized_at: Date | null;
  created_at: Date;
};

export type RosterEntry = Spot & { name: string; phone: string };

export function getGame(slug: string) {
  return one<Game>("select * from games where slug = $1", [slug]);
}

export function openGameForGroup(groupId: string) {
  return one<Game>(
    "select * from games where group_id = $1 and status = 'open' order by created_at desc limit 1",
    [groupId],
  );
}

export function personByToken(token: string | undefined | null) {
  if (!token) return Promise.resolve(undefined);
  return one<Person>("select * from people where token = $1", [token]);
}

export function personById(id: string) {
  return one<Person>("select * from people where id = $1", [id]);
}

export function roster(gameId: string) {
  return q<RosterEntry>(
    `select s.*, p.name, p.phone from spots s join people p on p.id = s.person_id
     where s.game_id = $1 order by s.created_at`,
    [gameId],
  );
}

export function inPlayers(entries: RosterEntry[]) {
  return entries.filter((e) => e.status === "in");
}

/** Holds cover the share plus the short-roster cap, so a short game can still be split. */
export function holdCents(game: Pick<Game, "share_cents" | "cap_cents">) {
  return game.share_cents + game.cap_cents;
}

export function money(cents: number) {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

export function whenLabel(d: Date) {
  const day = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: TZ }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ })
    .format(d)
    .replace(" ", "")
    .toLowerCase();
  return `${day} ${time}`;
}

export function shortWhen(d: Date) {
  return whenLabel(d).replace(":00", "");
}

export function gameUrl(slug: string) {
  const base = process.env.APP_URL ?? "";
  return `${base}/g/${slug}`;
}

export function gameHeadline(game: Game) {
  return `${whenLabel(game.starts_at)} · ${game.place}`;
}

export function isBeforeCancelBy(game: Game, now = new Date()) {
  return now.getTime() < new Date(game.cancel_by).getTime();
}

export async function logEvent(gameId: string, personId: string | null, kind: string, detail?: unknown) {
  await q("insert into events (game_id, person_id, kind, detail) values ($1, $2, $3, $4)", [
    gameId,
    personId,
    kind,
    detail === undefined ? null : JSON.stringify(detail),
  ]);
}

/** A Maps search link for the game: the street address when we have it, else the place name. */
export function mapsUrl(game: Pick<Game, "place" | "address">) {
  const query = game.address ? `${game.address} (${game.place})` : game.place;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** Invite-only games: is this person on the list? (Open games: everyone is.) */
export async function isInvited(game: Pick<Game, "id" | "invite_only" | "organizer_id">, personId: string) {
  if (!game.invite_only || personId === game.organizer_id) return true;
  return !!(await one("select 1 from invites where game_id = $1 and person_id = $2", [game.id, personId]));
}

export async function inviteeNames(gameId: string) {
  return (await q<{ name: string }>("select p.name from invites i join people p on p.id = i.person_id where i.game_id = $1 order by p.name", [gameId])).map((r) => r.name);
}
