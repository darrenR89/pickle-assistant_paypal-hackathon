import { NextResponse } from "next/server";
import { captureAuthorization } from "@/lib/paypal";
import { errorResponse, isAdmin } from "@/lib/http";

// Charge a held share. Test endpoint for now; later only the settlement workflow calls this.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id } = await params;
    const { amountCents } = (await req.json().catch(() => ({}))) as { amountCents?: number };
    const capture = await captureAuthorization(id, amountCents);
    return NextResponse.json(capture);
  } catch (err) {
    return errorResponse(err);
  }
}
