// Thin server-side client for the PayPal REST APIs used by the hold flow:
// Orders v2 (intent AUTHORIZE) and Payments v2 (capture / void).
// Docs: https://developer.paypal.com/docs/api/orders/v2/ and /payments/v2/

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
  init: { method: string; body?: unknown; requestId?: string },
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
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
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

/** Release the hold: the player is never charged. */
export function voidAuthorization(authorizationId: string) {
  return call<Record<string, unknown>>(
    `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`,
    { method: "POST", requestId: `void-${authorizationId}` },
  );
}

/** Charge the held share (all of it unless amountCents is given). */
export function captureAuthorization(authorizationId: string, amountCents?: number) {
  return call<Record<string, unknown>>(
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

export function firstAuthorization(order: Order) {
  return order.purchase_units?.[0]?.payments?.authorizations?.[0];
}
