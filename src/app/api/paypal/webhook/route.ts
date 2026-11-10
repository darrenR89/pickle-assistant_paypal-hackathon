import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { verifyWebhook } from "@/lib/paypal";
import { type PayPalEvent, handleWebhookEvent } from "@/lib/webhooks";

// PayPal webhooks: PayPal's word on every money change, so our records match PayPal's even when
// something happens outside the app (a hold expires, a capture is declined, a payout is unclaimed).
// Subscribe the app's webhook to: PAYMENT.AUTHORIZATION.VOIDED, PAYMENT.CAPTURE.COMPLETED,
// PAYMENT.CAPTURE.DENIED, PAYMENT.CAPTURE.REFUNDED, PAYMENT.PAYOUTSBATCH.*, PAYMENT.PAYOUTS-ITEM.*

type Event = PayPalEvent;

export async function POST(req: Request) {
  let event: Event;
  try {
    event = (await req.json()) as Event;
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  if (!event?.id || !event.event_type) return NextResponse.json({ error: "Not a PayPal event" }, { status: 400 });

  try {
    if (!(await verifyWebhook(req.headers, event))) return NextResponse.json({ error: "Signature check failed" }, { status: 401 });
  } catch (err) {
    console.error("webhook verify failed", err);
    return NextResponse.json({ error: "Couldn't verify" }, { status: 503 }); // PayPal retries later
  }

  // Each event is handled once; PayPal redelivers until it gets a 2xx.
  const fresh = await q("insert into webhook_events (id, type, resource_id, payload) values ($1, $2, $3, $4) on conflict do nothing returning id", [
    event.id,
    event.event_type,
    event.resource?.id ?? null,
    JSON.stringify(event),
  ]);
  if (!fresh.length) return NextResponse.json({ ok: true, duplicate: true });

  try {
    await handleWebhookEvent(event);
  } catch (err) {
    // Let PayPal redeliver: forget this delivery so the retry is processed.
    await q("delete from webhook_events where id = $1", [event.id]);
    console.error("webhook handling failed", event.event_type, err);
    return NextResponse.json({ error: "Handling failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
