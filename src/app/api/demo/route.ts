import { NextResponse } from "next/server";
import { createDemo } from "@/lib/demo";
import { errorResponse } from "@/lib/http";

// Start a phone demo: a fresh group chat where the judge will be the organizer.
export async function POST() {
  try {
    return NextResponse.json({ groupId: await createDemo() });
  } catch (err) {
    return errorResponse(err);
  }
}
