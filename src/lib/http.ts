import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { PayPalError } from "./paypal";

type PayPalErrorBody = { name?: string; debug_id?: string; details?: Array<{ issue?: string }> };

/**
 * Turn a thrown error into a JSON response. PayPal's full error body stays in the server log;
 * the browser gets only the issue code (e.g. INSTRUMENT_DECLINED, which the game page uses to
 * tell the player their card was declined) and PayPal's debug id for support.
 */
export function errorResponse(err: unknown) {
  if (err instanceof PayPalError) {
    console.error(err.message, err.status, JSON.stringify(err.details));
    const body = (err.details ?? {}) as PayPalErrorBody;
    const issue = body.details?.[0]?.issue ?? body.name;
    return NextResponse.json({ error: err.message, issue, debugId: body.debug_id }, { status: 502 });
  }
  console.error(err);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/** Capture and void are test-only endpoints for now; only the holder of ADMIN_TOKEN may call them. */
export function isAdmin(req: Request) {
  const token = process.env.ADMIN_TOKEN;
  const given = req.headers.get("x-admin-token");
  if (!token || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
