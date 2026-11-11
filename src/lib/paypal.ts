// Thin server-side client for the PayPal REST APIs the assistant uses:
// Orders v2 (intent AUTHORIZE), Payments v2 (capture / void / reauthorize / refund),
// Payouts v1 (paying the organizer back) and webhook signature verification.
// Docs: https://developer.paypal.com/docs/api/orders/v2/, /payments/v2/, /payments.payouts-batch/v1/

const BASE_URL =
  process.env.PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

export class PayPalError extends Error {
  constructor(
    message: string,
    public status: number,
    public details: unknown,
  ) {
    super(message);
  }
}

/** Give up on a PayPal call that hasn't answered, so one hung request can't hang a page or a settle. */
const TIMEOUT_MS = 20_000;

/**
 * PayPal has said this exact request can never succeed (the hold is gone, expired, already used
 * or declined), so trying again won't help. Anything else (a timeout, a 5xx, a rate limit, a bad
 * token) is worth a retry.
 */
export function isTerminalPayPalError(err: unknown) {
  return err instanceof PayPalError && (err.status === 404 || err.status === 422);
}

let cachedToken: { value: string; expiresAt: number } | null = null;

function credentials() {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set");
  }
  return { id, secret };
}

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }
  const { id, secret } = credentials();
  const res = await fetch(`${BASE_URL}/v1/oauth2/token`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  const body = await res.json();
  if (!res.ok) throw new PayPalError("PayPal auth failed", res.status, body);
  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  };
  return cachedToken.value;
}

async function call<T>(
  path: string,
  init: { method: string; body?: unknown; rawBody?: string; requestId?: string },
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await accessToken()}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  // PayPal-Request-Id makes retries safe: the same id never creates a second order or capture.
  if (init.requestId) headers["PayPal-Request-Id"] = init.requestId;
  const res = await fetch(`${BASE_URL}${path}`, {
    method: init.method,
    headers,
    body: init.rawBody ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new PayPalError(`PayPal ${init.method} ${path} failed`, res.status, body);
  return body as T;
}

type Money = { currency_code: string; value: string };

export type Order = {
  id: string;
  status: string;
  purchase_units?: Array<{
    payments?: { authorizations?: Array<{ id: string; status: string; amount: Money; expiration_time?: string }> };
  }>;
};

/** Create an order that only places a hold (authorization) when the player approves. */
export function createHoldOrder(opts: {
  amountCents: number;
  description: string;
  referenceId: string;
  requestId: string;
}) {
  return call<Order>("/v2/checkout/orders", {
    method: "POST",
    requestId: opts.requestId,
    body: {
      intent: "AUTHORIZE",
      purchase_units: [
        {
          reference_id: opts.referenceId,
          description: opts.description,
          amount: { currency_code: "USD", value: (opts.amountCents / 100).toFixed(2) },
        },
      ],
    },
  });
}

/** After the player approves, turn the approved order into an authorization (the hold). */
export function authorizeOrder(orderId: string) {
  return call<Order>(`/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, {
    method: "POST",
    body: {},
    requestId: `authorize-${orderId}`,
  });
}

// Demo shortcut: the /play simulator can place "SIM-" holds without a PayPal login, so testers can
// fill a game in seconds. They never reach PayPal; real holds always go through the calls below.
const isSim = (id: string) => id.startsWith("SIM-");
const simId = () => `SIM-${crypto.randomUUID().replace(/-/g, "").slice(0, 14).toUpperCase()}`;
export const newSimulatedAuthorization = simId;

/** Release the hold: the player is never charged. */
export function voidAuthorization(authorizationId: string) {
  if (isSim(authorizationId)) return Promise.resolve({ status: "VOIDED", simulated: true });
  return call<Record<string, unknown>>(
    `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`,
    { method: "POST", requestId: `void-${authorizationId}` },
  );
}

export type Capture = { id: string; status: string; amount?: Money; simulated?: boolean };

/** What PayPal says it captured, in cents. Falls back to what we asked for (simulated holds, or no amount in the reply). */
export function capturedCents(capture: Pick<Capture, "amount">, askedCents: number) {
  const cents = Math.round(Number(capture.amount?.value) * 100);
  return capture.amount?.value !== undefined && Number.isFinite(cents) && cents >= 0 ? cents : askedCents;
}

/** Charge the held share (all of it unless amountCents is given). Returns the capture, whose id refunds use. */
export function captureAuthorization(authorizationId: string, amountCents?: number): Promise<Capture> {
  if (isSim(authorizationId)) return Promise.resolve({ id: simId(), status: "COMPLETED", simulated: true });
  return call<Capture>(
    `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`,
    {
      method: "POST",
      requestId: `capture-${authorizationId}`,
      body:
        amountCents === undefined
          ? {}
          : { amount: { currency_code: "USD", value: (amountCents / 100).toFixed(2) }, final_capture: true },
    },
  );
}

/** Give money back on a capture ("I did show up"). Full refund unless amountCents is given. */
export function refundCapture(captureId: string, amountCents?: number, note?: string) {
  if (isSim(captureId)) return Promise.resolve({ id: simId(), status: "COMPLETED", simulated: true });
  return call<{ id: string; status: string }>(`/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
    method: "POST",
    requestId: `refund-${captureId}`,
    body: {
      ...(amountCents === undefined ? {} : { amount: { currency_code: "USD", value: (amountCents / 100).toFixed(2) } }),
      ...(note ? { note_to_payer: note.slice(0, 255) } : {}),
    },
  });
}

/**
 * Renew a hold after PayPal's 3-day honor period (allowed on days 4–29).
 * Returns the new authorization; the old one is no longer used.
 */
export function reauthorize(authorizationId: string, amountCents: number) {
  if (isSim(authorizationId)) return Promise.resolve({ id: simId(), status: "CREATED" });
  return call<{ id: string; status: string; expiration_time?: string }>(
    `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/reauthorize`,
    {
      method: "POST",
      requestId: `reauthorize-${authorizationId}`,
      body: { amount: { currency_code: "USD", value: (amountCents / 100).toFixed(2) } },
    },
  );
}

// ---------- Vault: approve now, hold later ----------
// For a game more than a few days out, the player saves their PayPal with us (a payment token)
// and the hold is placed from that token shortly before the game, with the player not present.
// Docs: https://developer.paypal.com/docs/checkout/save-payment-methods/purchase-later/payment-tokens-api/paypal/

/** Step 1: a setup token the player approves in the PayPal window. Nothing is held or charged. */
export function createSetupToken(opts: { description: string; returnUrl: string; requestId: string }) {
  return call<{ id: string; status: string }>("/v3/vault/setup-tokens", {
    method: "POST",
    requestId: opts.requestId,
    body: {
      payment_source: {
        paypal: {
          description: opts.description.slice(0, 127),
          usage_type: "MERCHANT",
          customer_type: "CONSUMER",
          experience_context: { shipping_preference: "NO_SHIPPING", return_url: opts.returnUrl, cancel_url: opts.returnUrl },
        },
      },
    },
  });
}

/** Step 2: after approval, swap the setup token for the long-lived payment token. It never goes to the browser. */
export function createPaymentToken(setupTokenId: string) {
  return call<{ id: string; customer?: { id: string } }>("/v3/vault/payment-tokens", {
    method: "POST",
    requestId: `payment-token-${setupTokenId}`,
    body: { payment_source: { token: { id: setupTokenId, type: "SETUP_TOKEN" } } },
  });
}

/** Forget a saved payment method, once its hold is placed or the player is out. */
export async function deletePaymentToken(paymentTokenId: string) {
  if (isSim(paymentTokenId)) return;
  await call<Record<string, never>>(`/v3/vault/payment-tokens/${encodeURIComponent(paymentTokenId)}`, { method: "DELETE" });
}

export const newSimulatedPaymentToken = simId;

/**
 * Place a hold from a saved payment method. PayPal processes an order made with a vault id straight
 * away; if it comes back approved but not yet authorized, authorize it the usual way.
 */
export async function placeVaultedHold(opts: { paymentTokenId: string; amountCents: number; description: string; referenceId: string; requestId: string }) {
  if (isSim(opts.paymentTokenId)) return { authorizationId: simId(), orderId: `SIM-ORDER-${simId().slice(4)}` };
  let order = await call<Order>("/v2/checkout/orders", {
    method: "POST",
    requestId: opts.requestId,
    body: {
      intent: "AUTHORIZE",
      purchase_units: [
        {
          reference_id: opts.referenceId,
          description: opts.description,
          amount: { currency_code: "USD", value: (opts.amountCents / 100).toFixed(2) },
        },
      ],
      payment_source: { paypal: { vault_id: opts.paymentTokenId } },
    },
  });
  if (!firstAuthorization(order)) order = await authorizeOrder(order.id);
  const auth = firstAuthorization(order);
  if (!auth) throw new PayPalError("PayPal returned no authorization for the saved payment method", 502, order);
  return { authorizationId: auth.id, orderId: order.id };
}

/**
 * The PayPal buttons need this to offer "save" on the page. Best effort: without it the buttons
 * still load, so a failure here must not break the game page.
 */
export async function userIdToken(): Promise<string | null> {
  try {
    const { id, secret } = credentials();
    const res = await fetch(`${BASE_URL}/v1/oauth2/token`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials&response_type=id_token",
      cache: "no-store",
    });
    const body = (await res.json()) as { id_token?: string };
    return res.ok && body.id_token ? body.id_token : null;
  } catch {
    return null;
  }
}

export function firstAuthorization(order: Order) {
  return order.purchase_units?.[0]?.payments?.authorizations?.[0];
}

// ---------- Payouts: pay the organizer back ----------

export type PayoutWallet = "VENMO" | "PAYPAL";
export type PayoutReceiver = { receiver: string; recipientType: "PHONE" | "EMAIL" | "USER_HANDLE"; wallet: PayoutWallet };

/**
 * Work out how to address a payout from what the organizer typed: an email goes to PayPal,
 * an @handle to Venmo, and a phone number to whichever wallet they picked (Venmo by default).
 */
export function payoutReceiver(raw: string, wallet: PayoutWallet = "VENMO"): PayoutReceiver | null {
  const v = raw.trim();
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return { receiver: v, recipientType: "EMAIL", wallet };
  if (/^@[A-Za-z0-9_-]{2,30}$/.test(v)) return { receiver: v.slice(1), recipientType: "USER_HANDLE", wallet: "VENMO" };
  const digits = v.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (digits.length === 10) return { receiver: digits, recipientType: "PHONE", wallet };
  return null;
}

export type PayoutBatch = { batch_header: { payout_batch_id: string; batch_status: string } };

/** Send one payout. PayPal-Request-Id and sender_batch_id are both tied to the game, so a retry never pays twice. */
export function createPayout(opts: { batchId: string; amountCents: number; to: PayoutReceiver; note: string; simulated?: boolean }) {
  if (opts.simulated) {
    return Promise.resolve<PayoutBatch & { simulated: true }>({
      batch_header: { payout_batch_id: `SIM-${opts.batchId.slice(-12).toUpperCase()}`, batch_status: "SUCCESS" },
      simulated: true,
    });
  }
  return call<PayoutBatch>("/v1/payments/payouts", {
    method: "POST",
    requestId: opts.batchId,
    body: {
      sender_batch_header: {
        sender_batch_id: opts.batchId,
        email_subject: "Your pickleball court money is here",
        email_message: opts.note,
      },
      items: [
        {
          recipient_type: opts.to.recipientType,
          recipient_wallet: opts.to.wallet,
          receiver: opts.to.receiver,
          amount: { value: (opts.amountCents / 100).toFixed(2), currency: "USD" },
          note: opts.note.slice(0, 4000),
          sender_item_id: opts.batchId,
        },
      ],
    },
  });
}

// ---------- Webhooks ----------

/**
 * The body for PayPal's signature check. The event goes in exactly as PayPal sent it: parsing and
 * re-writing it can change number formatting or escapes, and then a genuine event fails the check.
 */
export function verifyBody(fields: Record<string, string>, rawEvent: string) {
  return `${JSON.stringify(fields).slice(0, -1)},"webhook_event":${rawEvent}}`;
}

/** Ask PayPal whether a webhook really came from PayPal. Needs PAYPAL_WEBHOOK_ID from the app's webhook settings. */
export async function verifyWebhook(headers: Headers, rawEvent: string) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new Error("PAYPAL_WEBHOOK_ID must be set to receive webhooks");
  const h = (k: string) => headers.get(k) ?? "";
  const res = await call<{ verification_status: string }>("/v1/notifications/verify-webhook-signature", {
    method: "POST",
    rawBody: verifyBody(
      {
        auth_algo: h("paypal-auth-algo"),
        cert_url: h("paypal-cert-url"),
        transmission_id: h("paypal-transmission-id"),
        transmission_sig: h("paypal-transmission-sig"),
        transmission_time: h("paypal-transmission-time"),
        webhook_id: webhookId,
      },
      rawEvent,
    ),
  });
  return res.verification_status === "SUCCESS";
}
