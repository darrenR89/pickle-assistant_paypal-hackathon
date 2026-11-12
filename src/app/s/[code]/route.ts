import { NextResponse } from "next/server";
import { one } from "@/lib/db";

// Short links sent in real texts (src/lib/sendblue.ts). Only ever redirects to a path on this site.
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const row = /^[a-f0-9]{10}$/.test(code) ? await one<{ path: string }>("select path from short_links where code = $1", [code]) : null;
  const path = row?.path.startsWith("/g/") ? row.path : "/";
  return NextResponse.redirect(new URL(path, process.env.APP_URL || req.url), 302);
}
