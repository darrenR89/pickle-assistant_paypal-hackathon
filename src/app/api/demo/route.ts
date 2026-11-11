import { NextResponse } from "next/server";
import { createDemo } from "@/lib/demo";
import { errorResponse } from "@/lib/http";
import { allow, clientIp, tooMany } from "@/lib/rate";

// Start a phone demo: a fresh group chat where the judge will be the organizer.
export async function POST(req: Request) {
  try {
    if (!allow(`group:${clientIp(req)}`, 20, 10 * 60_000)) return tooMany();
    return NextResponse.json({ groupId: await createDemo() });
  } catch (err) {
    return errorResponse(err);
  }
}
