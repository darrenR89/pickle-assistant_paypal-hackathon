import { NextResponse } from "next/server";
import { createPlaygroundGroup } from "@/lib/playground";
import { errorResponse } from "@/lib/http";
import { allow, clientIp, tooMany } from "@/lib/rate";

export async function POST(req: Request) {
  try {
    if (!allow(`group:${clientIp(req)}`, 20, 10 * 60_000)) return tooMany();
    const groupId = await createPlaygroundGroup();
    return NextResponse.json({ groupId });
  } catch (err) {
    return errorResponse(err);
  }
}
