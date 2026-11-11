// Sanity limits for what an organizer (or the model reading their message) can set on a game,
// and the last check before a hold is placed. Pure functions, so the rules are easy to test.

export const MIN_SPOTS = 2;
export const MAX_SPOTS = 32;
/** $10,000: far above any court booking, and well inside a Postgres int once multiplied by spots. */
export const MAX_TOTAL_CENTS = 1_000_000;
/** $100 extra each if the game is short. */
export const MAX_CAP_CENTS = 10_000;

const WEEK = 7 * 86400_000;
const HOUR = 3600_000;

// ---------- Delayed holds: approve now, hold later ----------

/** Games further out than this save the payment method instead of holding right away. */
export const DELAY_IF_FURTHER_THAN = 3 * 24 * HOUR;
/** The hold is placed this long before the start: inside PayPal's 3-day honor period even at settle time, and a day before free cancel ends. */
export const HOLD_LEAD = 2 * 24 * HOUR;
/** How long a player has to approve again after a delayed hold fails. */
export const FIX_WINDOW = 24 * HOUR;

/** Off unless DELAYED_HOLDS=on, so the feature can ship dark and be switched off without a deploy of code. */
export function delayedHoldsOn() {
  return process.env.DELAYED_HOLDS === "on";
}

/** Should joining this game save the payment method now and place the hold later? */
export function delaysHold(startsAt: Date, now: Date, enabled: boolean) {
  return enabled && new Date(startsAt).getTime() - now.getTime() > DELAY_IF_FURTHER_THAN;
}

/** When a saved payment method's hold is placed. */
export function holdDate(startsAt: Date) {
  return new Date(new Date(startsAt).getTime() - HOLD_LEAD);
}

/** When a spot whose delayed hold failed is given up: a day to fix it, but never later than 3 hours before the game. */
export function fixDeadline(failedAt: Date, startsAt: Date) {
  return new Date(Math.min(new Date(failedAt).getTime() + FIX_WINDOW, new Date(startsAt).getTime() - 3 * HOUR));
}

/** A PayPal hold lasts 29 days, so a game further out than this couldn't be charged from a hold placed today. */
export const MAX_DAYS_AHEAD = 28;

export function tooFarAhead(startsAt: Date, now: Date) {
  return startsAt.getTime() - now.getTime() > MAX_DAYS_AHEAD * 86400_000;
}

/** A spot count we can run a game with, else undefined (the caller falls back to its default). */
export function saneSpots(n: number | undefined) {
  if (n === undefined || !Number.isFinite(n)) return undefined;
  const whole = Math.round(n);
  return whole >= MIN_SPOTS && whole <= MAX_SPOTS ? whole : undefined;
}

/** A price in cents we can hold against, else undefined (the organizer is asked for it). */
export function sanePriceCents(n: number | undefined) {
  if (n === undefined || !Number.isFinite(n)) return undefined;
  const whole = Math.round(n);
  return whole > 0 && whole <= MAX_TOTAL_CENTS ? whole : undefined;
}

/**
 * A start time that is still ahead. "Thu 6pm" said on Thursday night means next Thursday, so a
 * time in the last week moves forward one week; anything older, or more than four weeks out (longer
 * than a PayPal hold lasts), is dropped and asked for again.
 */
export function saneStart(startsAt: Date | undefined, now: Date) {
  if (!startsAt || Number.isNaN(startsAt.getTime())) return undefined;
  if (tooFarAhead(startsAt, now)) return undefined;
  if (startsAt.getTime() > now.getTime()) return startsAt;
  const bumped = new Date(startsAt.getTime() + WEEK);
  return bumped.getTime() > now.getTime() ? bumped : undefined;
}

/** What's wrong with an organizer's edit, in words for the form, or null if it's fine. */
export function termsProblem(change: { spots?: number; totalCents?: number; capCents?: number }, draft: boolean) {
  const { spots, totalCents, capCents } = change;
  if (spots !== undefined && (spots < MIN_SPOTS || spots > MAX_SPOTS)) return `Spots must be between ${MIN_SPOTS} and ${MAX_SPOTS}.`;
  if (totalCents !== undefined && totalCents > MAX_TOTAL_CENTS) return "That court cost is too high.";
  // A draft can be saved before the price is known; a posted game needs one to hold against.
  if (totalCents !== undefined && totalCents <= 0 && !draft) return "Add the court cost.";
  if (capCents !== undefined && capCents > MAX_CAP_CENTS) return "The short-game extra is too high.";
  return null;
}

/**
 * Why a hold can't be placed, or null if it can. Checked when the order is created and again when
 * the player comes back from PayPal, because a game can fill up or close in between.
 */
export function holdBlocked(game: { status: string; spots: number }, inCount: number, offered: boolean) {
  if (game.status !== "open") return "This game just closed, so no hold was placed.";
  // Someone handed a spot can still join a full game: the giver's spot is released when they do.
  if (inCount >= game.spots && !offered) return "The game just filled up, so no hold was placed.";
  return null;
}
