import { NextResponse } from "next/server";
import { PayPalError } from "./paypal";

export function errorResponse(err: unknown) {
  if (err instanceof PayPalError) {
    console.error(err.message, err.status, JSON.stringify(err.details));
    return NextResponse.json({ error: err.message, details: err.details }, { status: 502 });
  }
  console.error(err);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/** Capture and void are test-only endpoints for now; only the holder of ADMIN_TOKEN may call them. */
export function isAdmin(req: Request) {
  const token = process.env.ADMIN_TOKEN;
  return Boolean(token) && req.headers.get("x-admin-token") === token;
}
