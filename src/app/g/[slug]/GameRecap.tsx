"use client";

import { useEffect, useRef, useState } from "react";
import { BURST_SECONDS, makeBurst } from "@/lib/burst";
import type { ViewData } from "./page";

// "Game complete" recap, shown once per game on this device the first time a player who paid (or the organizer)
// opens the game page after it settles. Like a sports app's end-of-week screen: a pickleball burst, a headline and
// the money in plain words. Every amount comes from the server's view; nothing here works one out beyond a
// subtraction for display. Reduced motion shows it without the burst.

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

// The headline, picked per game so it stays the same each time that game's recap opens. The last words are highlighted.
const HEADLINES: Array<[string, string]> = [
  ["Hope you didn’t get", "pickled."],
  ["That’s game,", "point, match."],
  ["Dinks were", "delivered."],
  ["You stayed out of", "the kitchen."],
  ["Zero, zero,", "settled."],
  ["Nice hands at", "the net."],
  ["Erne, drop,", "dink, done."],
  ["Paddles down,", "all paid up."],
];
function headlineFor(slug: string) {
  let h = 7;
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) % 100003;
  return HEADLINES[h % HEADLINES.length];
}

export default function GameRecap({ v }: { v: ViewData }) {
  const org = v.organizer;
  const eligible = v.status === "settled" && (v.me === "paid" || Boolean(org));
  const key = `recap-seen:${v.slug}${org ? ":o" : ""}`;
  const [open, setOpen] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!eligible) return;
    let seen = false;
    try { seen = localStorage.getItem(key) === "1"; } catch { /* private mode: show it */ }
    if (!seen) setOpen(true); // eslint-disable-line react-hooks/set-state-in-effect -- reads storage once after mount
  }, [eligible, key]);

  function close() {
    try { localStorage.setItem(key, "1"); } catch { /* fine */ }
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    btn.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    const c = canvas.current;
    if (!c || matchMedia("(prefers-reduced-motion: reduce)").matches) return () => window.removeEventListener("keydown", onKey);
    const dpr = Math.min(2, devicePixelRatio || 1), W = c.clientWidth, H = c.clientHeight;
    c.width = W * dpr; c.height = H * dpr;
    const x = c.getContext("2d")!;
    const draw = makeBurst((W * dpr) / 2, (H * dpr) * 0.32, (dpr * W) / 780);
    let raf = 0, t0 = 0;
    const frame = (ms: number) => {
      if (!t0) t0 = ms;
      const t = (ms - t0) / 1000 + 0.05;
      x.clearRect(0, 0, c.width, c.height); draw(x, t);
      if (t < BURST_SECONDS) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("keydown", onKey); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;
  const [lead, hit] = headlineFor(v.slug);
  const rows: Array<[string, string, boolean?]> = org
    ? [["Played", `${v.players.length} of ${v.spots}`], ["Court cost", money(org.totalCents)], ["Collected", money(org.collectedCents), true]]
    : [
        ["Played", `${v.players.length} of ${v.spots}`],
        ["Your hold", money(v.myHoldCents)],
        ["Released", money(Math.max(0, v.myHoldCents - v.myChargedCents))],
        ...(v.myRefundedCents > 0 ? [["Refunded", money(v.myRefundedCents)] as [string, string]] : []),
        ["You paid", money(v.myChargedCents - v.myRefundedCents), true],
      ];

  return (
    <div className="recap" role="dialog" aria-modal="true" aria-labelledby="recap-h">
      <canvas ref={canvas} className="recap-fx" aria-hidden="true" />
      <div className="recap-in">
        <p className="recap-eyebrow">Game complete · {v.dateLabel}</p>
        <h2 id="recap-h">{lead} <span>{hit}</span></h2>
        <p className="recap-sub">{v.place} · {v.players.length} played</p>
        <div className="recap-card">
          <p className="recap-cap">{org ? "Your game" : "Your recap"}</p>
          <dl>
            {rows.map(([k, val, strong]) => (
              <div key={k} className={strong ? "strong" : undefined}><dt>{k}</dt><dd>{val}</dd></div>
            ))}
          </dl>
          <p className="recap-note">{org ? "Everyone’s receipt went out privately. Nobody chased anyone." : "Your receipt was sent privately. Nobody chased anyone."}</p>
        </div>
        <button ref={btn} type="button" className="recap-btn" onClick={close}>See the game</button>
      </div>
    </div>
  );
}
