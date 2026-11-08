import { NextResponse } from "next/server";
import { authorizeOrder, firstAuthorization } from "@/lib/paypal";
import { errorResponse } from "@/lib/http";

// Step 2 of a hold: the player approved in PayPal or Venmo; place the authorization.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const order = await authorizeOrder(id);
    const auth = firstAuthorization(order);
    if (!auth) return NextResponse.json({ error: "No authorization returned" }, { status: 502 });
    // TODO(build plan, Sat): save the authorization against the player and game in Postgres.
    return NextResponse.json({
      orderId: order.id,
      authorizationId: auth.id,
      status: auth.status,
      amount: auth.amount,
      expiresAt: auth.expiration_time,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
