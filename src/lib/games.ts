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
  /** Demo games only: the simulator's clock offset in ms (bigint, so it can arrive as a string). Real games: 0. */
  clock_offset_ms?: number | string | null;
  status: "draft" | "open" | "settling" | "cancelling" | "cancelled" | "settled";
  cancel_reminder_sent: boolean;
  gameday_reminder_sent: boolean;
  payout_status: null | "sending" | "pending" | "sent" | "unclaimed" | "failed" | "none";
  payout_cents: number | null;
  payout_batch_id: string | null;
  payout_error: string | null;
  payout_attempts: number;
  payout_round: number;
  close_choice: null | "split" | "covered" | "released" | "charged";
  /** The choice a settle or call-off started with, kept so an interrupted one finishes the same way. */
  closing_choice: null | "split" | "cover" | "charge" | "release";
  status_changed_at: Date | null;
  created_at: Date;
};

export type Person = { id: string; name: string; phone: string; token: string; payout_to: string | null; payout_wallet: "VENMO" | "PAYPAL" | null };

export type Spot = {
  id: string;
  game_id: string;
  person_id: string;
  status: "in" | "out";
  order_id: string | null;
  authorization_id: string | null;
  hold_cents: number | null;
  /** saved: payment method saved, hold placed later. failed: that later hold didn't go through. */
  hold_status: "none" | "held" | "voided" | "captured" | "saved" | "failed";
  vault_token: string | null;
  hold_failed_at: Date | null;
  captured_cents: number | null;
  capture_id: string | null;
  refunded_cents: number;
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

/** "Now" for this game: the real time, or the simulator's time for a demo game whose clock was moved. */
export function gameNow(game: { clock_offset_ms?: number | string | null }) {
  return new Date(Date.now() + Number(game.clock_offset_ms ?? 0));
}

export function isBeforeCancelBy(game: Game, now = gameNow(game)) {
  return now.getTime() < new Date(game.cancel_by).getTime();
}

/** The free-cancel rule as it stands now. A game set up inside its last 24 hours has none left. */
export function cancelRule(game: Pick<Game, "cancel_by" | "clock_offset_ms">, now = gameNow(game)) {
  return now.getTime() < new Date(game.cancel_by).getTime() ? `free cancel until ${whenLabel(new Date(game.cancel_by))}` : "free cancel has ended";
}

/** The organizer's payout has gone out (or is going), so money can't be taken back out of it. */
export function payoutUnderway(status: Game["payout_status"]) {
  return status === "sending" || status === "pending" || status === "sent" || status === "unclaimed";
}

/** The game-day reminder, worded for how far off the game really is (a game can be set up an hour before). */
export function gameDayLine(game: Pick<Game, "starts_at" | "place" | "clock_offset_ms">, now = gameNow(game)) {
  const mins = (new Date(game.starts_at).getTime() - now.getTime()) / 60_000;
  const lead = mins >= 100 ? "Game in 2 hours" : mins >= 45 ? "Game in about an hour" : "Game starting soon";
  return `${lead}: ${whenLabel(new Date(game.starts_at))} at ${game.place}. See you there!`;
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
