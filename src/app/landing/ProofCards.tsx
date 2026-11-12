"use client";

import { useContext, useEffect, useState } from "react";
import { FoldOpen } from "./CaseStudy";

export type Proof = { n: number; k: string; v: string };

const COUNT_MS = 1400;
const HOLD_MS = 250; // stay at 0 while the fold starts opening, so the count is seen from its first frame

// The proof cards inside the judges' fold. When the fold opens, the cards rise in one after another and every number
// counts up from 0. All counters share one clock, so they land on their final numbers at the same moment.
// The server HTML has the final numbers; reduced motion shows them straight away.
export default function ProofCards({ items }: { items: Proof[] }) {
  const open = useContext(FoldOpen);
  const [t, setT] = useState(1); // 0..1 progress of the count-up

  useEffect(() => {
    // t starts at 1 (final numbers) and only changes inside animation frames: the first frame resets it to 0.
    if (!open || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let start = 0;
    const step = (now: number) => {
      if (!start) start = now;
      const p = Math.min(1, Math.max(0, now - start - HOLD_MS) / COUNT_MS);
      setT(p);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // Ease-out cubic: fast start, gentle landing. Rounding down until the last frame keeps every number one step short
  // of its target until then, so small numbers (1, 8) don't land early.
  const ease = 1 - Math.pow(1 - t, 3);
  return (
    <ul className={`lp-proof${open ? " in" : ""}`}>
      {items.map(({ n, k, v }, i) => (
        <li key={k} style={{ ["--i" as string]: i }}>
          <span className="lp-proof-n" aria-hidden="true">{t >= 1 ? n : Math.floor(n * ease)}</span>
          <div>
            <h3><span className="sr-only">{n} </span>{k}</h3>
            <p>{v}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
