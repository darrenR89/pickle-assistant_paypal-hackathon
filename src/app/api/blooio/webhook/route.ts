import { after } from "next/server";
import { blooioConfigured } from "@/lib/blooio";
import { handleBlooioWebhook } from "@/bot/imessage";

// Blooio webhook: every text in an iMessage group the assistant is in, and 1:1 texts to it.
// Point Blooio's webhook at https://<your-app>/api/blooio/webhook. The signature is checked when
// BLOOIO_WEBHOOK_SECRET is set. We answer 200 at once and handle the message after.
export async function POST(req: Request) {
  if (!blooioConfigured()) return new Response("Not configured", { status: 404 });
  return handleBlooioWebhook(req, (task) => after(task));
}
