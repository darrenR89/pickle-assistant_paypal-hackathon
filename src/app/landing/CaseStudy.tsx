"use client";

import { useEffect, useState, type ReactNode } from "react";

// "How this was built" as one card that unfolds: a row with the title, a one-line summary and a pill button, then the
// chapters. The chapters stay in the server HTML (for crawlers and AI readers) and are inert while folded.
// Following a link to #built opens it.
export default function CaseStudy({ summary, children }: { summary: string; children: ReactNode }) {
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
        <span className="lp-cs-thumb" aria-hidden="true"><b>05</b>chapters</span>
        <div className="lp-cs-txt">
          <p className="lp-eyebrow">Case study</p>
          <h2 id="built-h">How this was built</h2>
          <p>{summary}</p>
        </div>
        <button type="button" className="lp-cs-cta" aria-expanded={open} aria-controls="built-body" onClick={() => setOpen((o) => !o)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6l5 5 5-5" /></svg>
          <span>{open ? "Close" : "Read the case study"}</span>
        </button>
      </div>
      <div className="lp-cs-unfold" id="built-body" inert={!open}>
        <div><div className="lp-cs-body">{children}</div></div>
      </div>
    </div>
  );
}
