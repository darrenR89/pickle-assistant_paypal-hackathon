"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// Sticky header. Over the hero it is a centered wordmark with links on each side; once the page
// scrolls it shrinks into a black pill shaped like the iPhone's Dynamic Island. Hover, keyboard
// focus or a tap on the pill opens the links inside it.
export default function IslandNav({ repo }: { repo: string }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const s = window.scrollY > 48;
      setScrolled(s);
      if (!s) setOpen(false);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`lp-isle${scrolled ? " scrolled" : ""}${open ? " open" : ""}`}>
      <nav className="lp-isle-side l" aria-label="Sections">
        <a href="#screens">The app</a>
        <a href="#built">How it was built</a>
      </nav>
      <div className="lp-isle-pill">
        <a href="#top" className="lp-logo">
          <span className="lp-ball" aria-hidden="true" /> Pickleball assistant
        </a>
        <Link href="/demo" className="lp-isle-peek" tabIndex={scrolled ? 0 : -1}>Try it</Link>
        <button
          type="button"
          className="lp-isle-more-btn"
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          tabIndex={scrolled ? 0 : -1}
          onClick={() => setOpen((o) => !o)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h14M5 15h14" /></svg>
        </button>
        <span className="lp-isle-more">
          <a href="#screens" tabIndex={scrolled ? 0 : -1}>The app</a>
          <a href="#built" tabIndex={scrolled ? 0 : -1}>Built</a>
          <a href={repo} tabIndex={scrolled ? 0 : -1}>GitHub</a>
          <Link href="/demo" className="lp-isle-cta" tabIndex={scrolled ? 0 : -1}>Try it live</Link>
        </span>
      </div>
      <nav className="lp-isle-side r" aria-label="Actions">
        <a href={repo}>GitHub</a>
        <Link href="/demo" className="lp-isle-cta">Try it live</Link>
      </nav>
    </header>
  );
}
