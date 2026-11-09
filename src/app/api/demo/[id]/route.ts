import { NextResponse } from "next/server";
import { type DemoAction, demoAct, demoState } from "@/lib/demo";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const state = await demoState((await params).id);
    return state ? NextResponse.json(state) : NextResponse.json({ error: "Unknown demo" }, { status: 404 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = (await req.json().catch(() => ({}))) as DemoAction;
    const r = await demoAct((await params).id, body);
    return NextResponse.json(r, { status: r.ok ? 200 : 409 });
  } catch (err) {
    return errorResponse(err);
  }
}
