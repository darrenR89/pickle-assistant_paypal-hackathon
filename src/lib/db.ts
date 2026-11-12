import { Pool, type PoolClient, type QueryResultRow } from "pg";

// One pool per server process. DATABASE_URL comes from Render (or your .env locally).
const globalForPool = globalThis as unknown as { pgPool?: Pool; schemaReady?: Promise<void> };

function pool() {
  if (!globalForPool.pgPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL must be set");
    globalForPool.pgPool = new Pool({
      connectionString: url,
      // Render's external URLs need TLS; internal ones don't.
      ssl: url.includes("render.com") ? { rejectUnauthorized: false } : undefined,
      max: 5,
    });
  }
  return globalForPool.pgPool;
}

const SCHEMA = `
create table if not exists people (
  id text primary key,
  name text not null,
  phone text unique not null,
  token text unique not null,
  created_at timestamptz not null default now()
);
create table if not exists groups (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);
create table if not exists group_members (
  group_id text not null,
  person_id text not null,
  primary key (group_id, person_id)
);
alter table group_members add column if not exists position int not null default 100;
-- dm_to null = posted in the group; otherwise a private 1:1 message to that person.
create table if not exists messages (
  id bigserial primary key,
  group_id text not null,
  sender_id text,
  dm_to text,
  text text not null,
  game_slug text,
  created_at timestamptz not null default now()
);
create index if not exists messages_group_idx on messages (group_id, id);
create table if not exists games (
  id text primary key,
  slug text unique not null,
  group_id text not null,
  organizer_id text not null,
  starts_at timestamptz not null,
  place text not null,
  spots int not null,
  total_cents int not null,
  share_cents int not null,
  cap_cents int not null,
  cancel_by timestamptz not null,
  organizer_pays boolean not null default true,
  organizer_token text not null,
  status text not null default 'open',
  created_at timestamptz not null default now()
);
-- One row per person per game. status: in | out. hold_status: none | held | voided | captured.
create table if not exists spots (
  id text primary key,
  game_id text not null,
  person_id text not null,
  status text not null,
  order_id text,
  authorization_id text,
  hold_cents int,
  hold_status text not null default 'none',
  captured_cents int,
  late_cancel text, -- null | pending | charged | covered
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_id, person_id)
);
alter table games add column if not exists cancel_reminder_sent boolean not null default false;
alter table games add column if not exists gameday_reminder_sent boolean not null default false;
alter table games add column if not exists address text;
-- Match details shown in the header and the players card.
alter table games add column if not exists kind text;
alter table games add column if not exists partners text;
alter table games add column if not exists level text;
alter table games add column if not exists ends_at timestamptz;
alter table games add column if not exists setting text;
alter table games add column if not exists courts text;
alter table games add column if not exists invite_only boolean not null default false;
-- A draft game is waiting on the organizer for these (when, place, price) before it's posted.
alter table games add column if not exists needs text[] not null default '{}';
create table if not exists invites (
  game_id text not null,
  person_id text not null,
  primary key (game_id, person_id)
);
alter table spots add column if not exists authorized_at timestamptz;
-- Private texts are opt-in: each new 1:1 chat costs money, so only open one when asked.
alter table people add column if not exists texts_opt_in boolean not null default false;
-- Demo groups made by /play. Testing shortcuts (simulated holds, moving the clock) only work on these.
alter table groups add column if not exists playground boolean not null default false;
-- Phone demo: who the phone is currently acting as, and the judge's name once their phone connects.
alter table groups add column if not exists demo_viewer text;
alter table groups add column if not exists demo_name text;
alter table people add column if not exists texts_welcomed boolean not null default false;
-- Phone demo by text (Sendblue): the judge's number, the join code they text, and their name until it connects.
alter table groups add column if not exists demo_phone text;
alter table groups add column if not exists demo_code text;
alter table groups add column if not exists demo_phone_name text;
-- Short links for real texts: a long game link breaks across lines in Messages and gets no preview.
create table if not exists short_links (
  code text primary key,
  path text not null,
  created_at timestamptz not null default now()
);
create table if not exists sendblue_seen (
  message_handle text primary key,
  seen_at timestamptz not null default now()
);
-- Binds a PayPal order to the game and person server-side, so the browser can't swap them.
create table if not exists pending_orders (
  order_id text primary key,
  game_id text not null,
  person_id text not null,
  hold_cents int not null,
  created_at timestamptz not null default now()
);
-- People who said "in" in the chat, for the one reminder before cancel-by.
create table if not exists intents (
  game_id text not null,
  person_id text not null,
  said_at timestamptz not null default now(),
  nudged boolean not null default false,
  primary key (game_id, person_id)
);
-- said_in: said "in" but hasn't approved the hold yet. maybe: tentative. waitlist: wants the next open spot.
alter table intents add column if not exists kind text not null default 'said_in';
-- Captures and refunds. capture_id is what PayPal refunds against.
alter table spots add column if not exists capture_id text;
alter table spots add column if not exists refunded_cents int not null default 0;
-- Where the organizer is paid back: a Venmo phone/@handle or a PayPal email. Defaults to their phone on Venmo.
alter table people add column if not exists payout_to text;
alter table people add column if not exists payout_wallet text;
-- Paying the organizer back after settle-up (PayPal Payouts).
-- payout_status: null | sending | pending | sent | unclaimed | failed | none (nothing to pay).
alter table games add column if not exists payout_status text;
alter table games add column if not exists payout_cents int;
alter table games add column if not exists payout_batch_id text;
alter table games add column if not exists payout_error text;
alter table games add column if not exists payout_attempts int not null default 0;
-- Bumped when PayPal definitely rejected or returned a payout, so the next try is a new batch (a plain retry reuses the batch id and can't pay twice).
alter table games add column if not exists payout_round int not null default 0;
-- How the game closed: split | covered (short roster), released | charged (called off).
alter table games add column if not exists close_choice text;
-- Recovering from a restart mid-settle or mid-call-off: when the game last changed status, and the
-- choice it was closing with (split | cover | charge | release), so the scheduled job can finish it.
alter table games add column if not exists status_changed_at timestamptz;
alter table games add column if not exists closing_choice text;
alter table games add column if not exists payout_started_at timestamptz;
-- Demo games only: how far the simulator's clock is ahead of (or behind) the real one, in ms. Real games stay at 0.
alter table games add column if not exists clock_offset_ms bigint not null default 0;
-- Delayed holds (DELAYED_HOLDS=on): for a game more than 3 days out the player saves their PayPal
-- (hold_status 'saved', vault_token set) and the hold is placed 2 days before the game. If that
-- fails the spot is 'failed' until they approve again or the fix window runs out.
alter table spots add column if not exists vault_token text;
alter table spots add column if not exists hold_failed_at timestamptz;
-- pending_orders also tracks a setup token waiting for approval (kind 'save').
alter table pending_orders add column if not exists kind text not null default 'order';
-- PayPal allows one reauthorization per hold.
alter table spots add column if not exists reauthorized boolean not null default false;
-- PayPal webhook events already handled, so a redelivery is a no-op.
create table if not exists webhook_events (
  id text primary key,
  type text not null,
  resource_id text,
  payload jsonb not null,
  received_at timestamptz not null default now()
);
create table if not exists events (
  id bigserial primary key,
  game_id text not null,
  person_id text,
  kind text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);
`;

async function ensureSchema() {
  if (!globalForPool.schemaReady) {
    globalForPool.schemaReady = pool()
      .query(SCHEMA)
      .then(() => undefined)
      .catch((err) => {
        globalForPool.schemaReady = undefined;
        throw err;
      });
  }
  return globalForPool.schemaReady;
}

export async function q<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
  await ensureSchema();
  const res = await pool().query<T>(text, params);
  return res.rows;
}

export async function one<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
  const rows = await q<T>(text, params);
  return rows[0];
}

export async function tx<T>(fn: (client: PoolClient) => Promise<T>) {
  await ensureSchema();
  const client = await pool().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function newToken() {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}
