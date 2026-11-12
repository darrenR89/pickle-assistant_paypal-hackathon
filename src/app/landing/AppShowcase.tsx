"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type TouchEvent } from "react";

export type ShowcaseStep = {
  tab: string; // step label in the timeline
  title: string; // slogan line, bottom left
  body: string; // shown under the active step
  chips: [string, string]; // callouts floating beside the phone
};

const DUR = 8000; // ms per step

// "How it works": a dark stage with the title top left, a vertical numbered timeline, one large phone that swaps
// screens with two callout chips beside it, and the active step's slogan bottom left. While it plays, the line under
// the active number fills over DUR and then the next step starts. Stacked on phones, only the current step shows,
// centered between previous/next arrows, and the ring around its number fills instead; tapping it, the arrows or a
// sideways swipe over the section moves between steps.
// Accessibility (WCAG 2.2.2): a Pause/Play button; it also holds while the mouse is over the phone, while keyboard
// focus is on the steps, and while the section is off screen. Picking a step stops it. Reduced motion never auto-plays.
// Phones are rendered by the server and passed in, so every screen is in the HTML and crossfades.
export default function AppShowcase({ steps, phones, title, lead }: { steps: ShowcaseStep[]; phones: ReactNode[]; title: string; lead: string }) {
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(true);
  const [paused, setPaused] = useState(false);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [visible, setVisible] = useState(false);
  const [seen, setSeen] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const left = useRef(DUR);
  const since = useRef(0);
  const shown = useRef(0);
  const held = paused || hover || focus || !visible;

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setAuto(false);
    const io = new IntersectionObserver(([e]) => { setVisible(e.isIntersecting); if (e.isIntersecting) setSeen(true); }, { threshold: 0.35 });
    if (stage.current) io.observe(stage.current);
    return () => io.disconnect();
  }, []);

  // One timeout per step, resumed with whatever time was left when it was held.
  useEffect(() => {
    if (shown.current !== i) {
      shown.current = i;
      left.current = DUR;
    }
    if (!auto || held) return;
    since.current = performance.now();
    const t = setTimeout(() => setI((n) => (n + 1) % steps.length), left.current);
    return () => {
      clearTimeout(t);
      left.current = Math.max(0, left.current - (performance.now() - since.current));
    };
  }, [i, auto, held, steps.length]);

  // When stacked, only the current step shows, so tapping it moves on to the next one.
  const stacked = () => window.matchMedia("(max-width: 760px)").matches;

  function pick(n: number, moveFocus = false) {
    setAuto(false);
    setPaused(false);
    setI(n);
    if (moveFocus) tabs.current[n]?.focus();
  }

  const go = (d: number) => pick((i + d + steps.length) % steps.length);

  // Phones: a sideways swipe anywhere on the section moves a step. Vertical drags are left to page scrolling.
  const touch = useRef<{ x: number; y: number } | null>(null);
  function onTouchStart(e: TouchEvent) {
    touch.current = stacked() ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  }
  function onTouchEnd(e: TouchEvent) {
    const t0 = touch.current;
    touch.current = null;
    if (!t0) return;
    const dx = e.changedTouches[0].clientX - t0.x, dy = e.changedTouches[0].clientY - t0.y;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  }

  function toggle() {
    if (!auto) {
      // Resume from a picked step: carry on with the next one.
      setAuto(true);
      setPaused(false);
      setI((n) => (n + 1) % steps.length);
    } else setPaused((p) => !p);
  }

  function onKey(e: KeyboardEvent) {
    const last = steps.length - 1;
    const to = e.key === "ArrowDown" || e.key === "ArrowRight" ? (i === last ? 0 : i + 1)
      : e.key === "ArrowUp" || e.key === "ArrowLeft" ? (i === 0 ? last : i - 1)
      : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (to === null) return;
    e.preventDefault();
    pick(to, true);
  }

  const running = auto && !paused;
  const s = steps[i];
  return (
    <div className={`lp-show${held ? " held" : ""}${seen ? " seen" : ""}`} ref={stage} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="lp-show-copy">
        <h2 id="how" className="lp-h2 light">{title}</h2>
        <p className="lp-show-lead">{lead}</p>
        <div className="lp-tl-wrap">
        <button type="button" className="lp-tl-arrow prev" aria-label="Previous step" onClick={() => go(-1)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <div
          className="lp-tl"
          role="tablist"
          aria-label="App screens"
          aria-orientation="vertical"
          style={{ ["--dur" as string]: `${DUR}ms` }}
          onKeyDown={onKey}
          onFocus={() => setFocus(true)}
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocus(false); }}
        >
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
              className={`lp-tl-item${n === i ? " on" : ""}${n < i ? " done" : ""}${n === i && auto ? " playing" : ""}`}
              onClick={() => pick(n === i && stacked() ? (n + 1) % steps.length : n)}
            >
              <span className="lp-tl-node" aria-hidden="true">{n + 1}<span className="lp-tl-ring" /></span>
              <span className="lp-tl-line" aria-hidden="true" />
              <span className="lp-tl-text">
                <span className="lp-tl-label">{st.tab}</span>
                <span className="lp-tl-body"><span>{st.body}</span></span>
              </span>
            </button>
          ))}
        </div>
        <button type="button" className="lp-tl-arrow next" aria-label="Next step" onClick={() => go(1)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
        </button>
        </div>
        <div className="lp-show-slogan" id="show-panel" role="tabpanel" aria-labelledby={`show-tab-${i}`} aria-live={auto ? "off" : "polite"}>
          <h3 key={s.title}>{s.title}</h3>
          <span className="sr-only">{s.chips.join(". ")}.</span>
        </div>
      </div>

      <div className="lp-show-device" onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)} onPointerLeave={(e) => e.pointerType === "mouse" && setHover(false)}>
        <div className="lp-show-phones">
          {phones.map((p, n) => (
            <div key={n} className={`lp-show-phone${n === i ? " on" : ""}`} aria-hidden={n !== i}>
              {p}
            </div>
          ))}
        </div>
        <button type="button" className="lp-tl-ctrl" aria-pressed={!running} onClick={toggle}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {running ? <><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></> : <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />}
          </svg>
          <span>{running ? "Pause" : "Play"}</span>
          <span className="sr-only"> the walkthrough</span>
        </button>
        <span key={`a${i}`} className="lp-chip a" aria-hidden="true"><i />{s.chips[0]}</span>
        <span key={`b${i}`} className="lp-chip b" aria-hidden="true"><i />{s.chips[1]}</span>
      </div>
    </div>
  );
}
