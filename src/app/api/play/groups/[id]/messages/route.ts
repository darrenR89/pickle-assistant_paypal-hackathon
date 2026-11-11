import { NextResponse } from "next/server";
import { one } from "@/lib/db";
import { handleGroupMessage } from "@/bot/assistant";
import { errorResponse } from "@/lib/http";
import { allow, tooMany } from "@/lib/rate";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { senderId, text } = (await req.json()) as { senderId?: string; text?: string };
    const clean = text?.trim().slice(0, 500);
    if (!senderId || !clean) return NextResponse.json({ error: "senderId and text are required" }, { status: 400 });
    // The simulator's way in. Real groups only take messages through their chat provider's signed webhook.
    const group = await one<{ playground: boolean }>("select playground from groups where id = $1", [id]);
    if (!group?.playground) return NextResponse.json({ error: "Unknown group" }, { status: 404 });
    const member = await one("select 1 from group_members where group_id = $1 and person_id = $2", [id, senderId]);
    if (!member) return NextResponse.json({ error: "Not in this group" }, { status: 403 });
    // Each message can call Claude, so cap how fast one chat can send.
    if (!allow(`msg:${id}`, 30, 60_000)) return tooMany();
    await handleGroupMessage(id, senderId, clean);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
