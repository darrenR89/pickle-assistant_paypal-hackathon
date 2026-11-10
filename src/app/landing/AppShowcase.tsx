"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type ShowcaseStep = {
  tab: string; // short pill label
  title: string; // slogan line, bottom left
  body: string;
  chips: [string, string]; // callouts floating beside the phone
};

// "The app" section: a dark stage with the title top left, pill tabs, one large phone that swaps screens, two
// callout chips beside it, and the active step's slogan bottom left. Steps advance on their own until the
// viewer picks one (never with reduced motion). Phones are rendered by the server and passed in, so every
// screen is in the HTML and crossfades instead of loading on click.
export default function AppShowcase({ steps, phones, title, lead }: { steps: ShowcaseStep[]; phones: ReactNode[]; title: string; lead: string }) {
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(true);
  const stage = useRef<HTMLDivElement>(null);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!auto || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Only run while the section is on screen.
    let t: ReturnType<typeof setInterval> | undefined;
    const io = new IntersectionObserver(([e]) => {
      clearInterval(t);
      if (e.isIntersecting) t = setInterval(() => setI((n) => (n + 1) % steps.length), 5200);
    }, { threshold: 0.35 });
    if (stage.current) io.observe(stage.current);
    return () => {
      io.disconnect();
      clearInterval(t);
    };
  }, [auto, steps.length]);

  function pick(n: number, focus = false) {
    setAuto(false);
    setI(n);
    if (focus) tabs.current[n]?.focus();
  }

  function onKey(e: KeyboardEvent) {
    const last = steps.length - 1;
    const to = e.key === "ArrowRight" || e.key === "ArrowDown" ? (i === last ? 0 : i + 1)
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i === 0 ? last : i - 1)
      : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (to === null) return;
    e.preventDefault();
    pick(to, true);
  }

  const s = steps[i];
  return (
    <div className="lp-show" ref={stage}>
      <div className="lp-show-copy">
        <h2 id="screens-h" className="lp-h2 light">{title}</h2>
        <p className="lp-show-lead">{lead}</p>
        <div className="lp-show-tabs" role="tablist" aria-label="App screens" onKeyDown={onKey}>
          {steps.map((st, n) => (
            <button
              key={st.tab}
              ref={(el) => { tabs.current[n] = el; }}
              type="button"
              role="tab"
              id={`show-tab-${n}`}
              aria-selected={n === i}
              aria-controls="show-panel"
              tabIndex={n === i ? 0 : -1}
              className={n === i ? "on" : ""}
              onClick={() => pick(n)}
            >
              <span className="lp-show-n" aria-hidden="true">{n + 1}</span>
              {st.tab}
            </button>
          ))}
        </div>
        <div className="lp-show-slogan" id="show-panel" role="tabpanel" aria-labelledby={`show-tab-${i}`} aria-live={auto ? "off" : "polite"}>
          <h3 key={s.title}>{s.title}</h3>
          <p key={s.body}>{s.body}</p>
          <span className="sr-only">{s.chips.join(". ")}.</span>
        </div>
      </div>

      <div className="lp-show-device">
        <div className="lp-show-phones">
          {phones.map((p, n) => (
            <div key={n} className={`lp-show-phone${n === i ? " on" : ""}`} aria-hidden={n !== i}>
              {p}
            </div>
          ))}
        </div>
        <span key={`a${i}`} className="lp-chip a" aria-hidden="true"><i />{s.chips[0]}</span>
        <span key={`b${i}`} className="lp-chip b" aria-hidden="true"><i />{s.chips[1]}</span>
      </div>
    </div>
  );
}
