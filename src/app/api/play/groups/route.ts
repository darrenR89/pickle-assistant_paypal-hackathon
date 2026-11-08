import { NextResponse } from "next/server";
import { createPlaygroundGroup } from "@/lib/playground";
import { errorResponse } from "@/lib/http";

export async function POST() {
  try {
    const groupId = await createPlaygroundGroup();
    return NextResponse.json({ groupId });
  } catch (err) {
    return errorResponse(err);
  }
}
