// A small in-memory rate limit for the open demo endpoints, which create rows and call Claude
// without any sign-in. One server process, so a Map is enough; it resets on deploy.

type Window = { count: number; resetAt: number };
const windows = new Map<string, Window>();

/** True if this key may go ahead: at most `max` calls per `windowMs`. */
export function allow(key: string, max: number, windowMs: number, now = Date.now()) {
  const w = windows.get(key);
  if (!w || w.resetAt <= now) {
    // Drop stale windows now and then so the map can't grow without bound.
    if (windows.size > 5000) for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k);
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  w.count++;
  return w.count <= max;
}

/** The caller's address as Render's proxy reports it. */
export function clientIp(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export function tooMany() {
  return Response.json({ error: "That's a lot of requests. Give it a minute and try again." }, { status: 429 });
}
