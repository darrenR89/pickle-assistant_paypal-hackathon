// Builds the "Proof from a real sandbox run" table for the README from what the database recorded.
// Pure functions only: scripts/proof.ts does the reading. Simulated ids (SIM-) never appear.

export type ProofSpot = {
  name: string;
  order_id: string | null;
  authorization_id: string | null;
  capture_id: string | null;
  hold_cents: number | null;
  captured_cents: number | null;
  refunded_cents: number;
  hold_status: string;
  reauthorized: boolean;
};

export type ProofGame = {
  slug: string;
  starts_at: Date;
  total_cents: number;
  payout_batch_id: string | null;
  payout_cents: number | null;
  payout_status: string | null;
};

export type ProofWebhook = { type: string; count: number };

const isReal = (id: string | null): id is string => id !== null && id !== "" && !id.startsWith("SIM-");

export function dollars(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

/** One row per PayPal object that really exists in the sandbox, in the order money moved. */
export function proofRows(game: ProofGame, spots: ProofSpot[]) {
  const rows: Array<[step: string, api: string, id: string, detail: string]> = [];
  for (const s of spots) {
    if (isReal(s.order_id)) rows.push(["Hold placed", "Orders v2 `intent: AUTHORIZE`", s.order_id, `${s.name}, ${dollars(s.hold_cents ?? 0)} order`]);
    if (isReal(s.authorization_id)) {
      rows.push(["Hold authorized", "`/v2/checkout/orders/{id}/authorize`", s.authorization_id, `${s.name}, ${dollars(s.hold_cents ?? 0)} held`]);
      if (s.reauthorized) rows.push(["Hold renewed", "`/v2/payments/authorizations/{id}/reauthorize`", s.authorization_id, s.name]);
      if (s.hold_status === "voided") rows.push(["Hold released", "`/v2/payments/authorizations/{id}/void`", s.authorization_id, `${s.name}, nothing charged`]);
    }
    if (isReal(s.capture_id)) {
      const of = s.hold_cents ? ` of ${dollars(s.hold_cents)} held` : "";
      rows.push(["Share charged", "`/v2/payments/authorizations/{id}/capture` (partial)", s.capture_id, `${s.name}, ${dollars(s.captured_cents ?? 0)}${of}`]);
      if (s.refunded_cents > 0) rows.push(["Refunded", "`/v2/payments/captures/{id}/refund`", s.capture_id, `${s.name}, ${dollars(s.refunded_cents)}`]);
    }
  }
  if (isReal(game.payout_batch_id)) {
    rows.push(["Organizer paid back", "Payouts v1 `/v1/payments/payouts`", game.payout_batch_id, `${dollars(game.payout_cents ?? 0)}, ${game.payout_status ?? "sent"}`]);
  }
  return rows;
}

export function proofMarkdown(game: ProofGame, spots: ProofSpot[], webhooks: ProofWebhook[]) {
  const rows = proofRows(game, spots);
  if (rows.length === 0) return null;
  const when = game.starts_at.toISOString().slice(0, 10);
  const lines = [
    `Game \`${game.slug}\` on ${when}, court ${dollars(game.total_cents)}. Every id below is a real PayPal sandbox object.`,
    "",
    "| Step | PayPal API | PayPal id | Detail |",
    "|---|---|---|---|",
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ];
  const seen = webhooks.filter((w) => w.count > 0);
  if (seen.length > 0) {
    lines.push("", `Verified webhooks received: ${seen.map((w) => `\`${w.type}\` (${w.count})`).join(", ")}.`);
  }
  return lines.join("\n");
}
