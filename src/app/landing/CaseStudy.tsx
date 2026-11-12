"use client";

import { createContext, useEffect, useState, type ReactNode } from "react";

// Whether the fold is open, for content inside it that animates when it unfolds (the proof cards' count-up).
export const FoldOpen = createContext(false);

// The judges' section as one card that unfolds: a row with the title, a one-line summary and a pill button, then the
// body. The body stays in the server HTML (for crawlers and AI readers) and is inert while folded.
// Following a link to #built opens it.
export default function CaseStudy({ eyebrow, title, summary, thumb, cta, children }: {
  eyebrow: string;
  title: string;
  summary: string;
  thumb: [string, string]; // big figure, small label under it
  cta: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const sync = () => { if (window.location.hash === "#built") setOpen(true); };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  return (
    <div className={`lp-cs${open ? " open" : ""}`}>
      <div className="lp-cs-row">
        <span className="lp-cs-thumb" aria-hidden="true"><b>{thumb[0]}</b>{thumb[1]}</span>
        <div className="lp-cs-txt">
          <p className="lp-eyebrow">{eyebrow}</p>
          <h2 id="built-h">{title}</h2>
          <p>{summary}</p>
        </div>
        <button type="button" className="lp-cs-cta" aria-expanded={open} aria-controls="built-body" onClick={() => setOpen((o) => !o)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6l5 5 5-5" /></svg>
          <span>{open ? "Close" : cta}</span>
        </button>
      </div>
      <div className="lp-cs-unfold" id="built-body" inert={!open}>
        <div><div className="lp-cs-body"><FoldOpen.Provider value={open}>{children}</FoldOpen.Provider></div></div>
      </div>
    </div>
  );
}
