import { NextResponse } from "next/server";
import { one } from "@/lib/db";
import { handleGroupMessage } from "@/bot/assistant";
import { errorResponse } from "@/lib/http";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { senderId, text } = (await req.json()) as { senderId?: string; text?: string };
    const clean = text?.trim().slice(0, 500);
    if (!senderId || !clean) return NextResponse.json({ error: "senderId and text are required" }, { status: 400 });
    const member = await one("select 1 from group_members where group_id = $1 and person_id = $2", [id, senderId]);
    if (!member) return NextResponse.json({ error: "Not in this group" }, { status: 403 });
    await handleGroupMessage(id, senderId, clean);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
