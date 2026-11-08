import { NextResponse } from "next/server";
import { voidAuthorization } from "@/lib/paypal";
import { errorResponse, isAdmin } from "@/lib/http";

// Release a hold. Test endpoint for now; later only the settlement workflow calls this.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id } = await params;
    await voidAuthorization(id);
    return NextResponse.json({ authorizationId: id, status: "VOIDED" });
  } catch (err) {
    return errorResponse(err);
  }
}
