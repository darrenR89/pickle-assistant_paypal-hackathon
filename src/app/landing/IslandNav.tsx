"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Logo from "../Logo";

// Sticky header. Over the hero it is a centered wordmark with links on each side; once the page
// scrolls it shrinks into a black pill shaped like the iPhone's Dynamic Island. Hover, keyboard
// focus or a tap on the pill opens the links inside it. Below desktop width the side links don't fit around
// the wordmark, so the top of the page shows a menu button that opens them in a panel instead.
// base is "" on the landing page and "/" elsewhere, so the section links lead back to the landing page.
export default function IslandNav({ repo, base = "" }: { repo: string; base?: string }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const s = window.scrollY > 48;
      setScrolled(s);
      if (!s) setOpen(false);
      else setMenu(false);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  const closeMenu = () => setMenu(false);

  return (
    <header className={`lp-isle${scrolled ? " scrolled" : ""}${open ? " open" : ""}`}>
      <nav className="lp-isle-side l" aria-label="Sections">
        <a href={`${base}#screens`}>The app</a>
        <a href={`${base}#built`}>How it was built</a>
      </nav>
      <div className="lp-isle-pill">
        <a href={`${base}#top`} className="lp-logo">
          <Logo />
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
          <a href={`${base}#screens`} tabIndex={scrolled ? 0 : -1}>The app</a>
          <a href={`${base}#built`} tabIndex={scrolled ? 0 : -1}>Built</a>
          <a href={repo} tabIndex={scrolled ? 0 : -1}>GitHub</a>
          <Link href="/demo" className="lp-isle-cta" tabIndex={scrolled ? 0 : -1}>Try it live</Link>
        </span>
      </div>
      <nav className="lp-isle-side r" aria-label="Actions">
        <a href={repo}>GitHub</a>
        <Link href="/demo" className="lp-isle-cta">Try it live</Link>
      </nav>
      <button
        type="button"
        className="lp-isle-burger"
        aria-expanded={menu}
        aria-controls="lp-isle-menu"
        aria-label={menu ? "Close menu" : "Open menu"}
        tabIndex={scrolled ? -1 : 0}
        onClick={() => setMenu((m) => !m)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          {menu ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      <nav id="lp-isle-menu" className="lp-isle-menu" aria-label="Menu" hidden={!menu}>
        <a href={`${base}#screens`} onClick={closeMenu}>The app</a>
        <a href={`${base}#built`} onClick={closeMenu}>How it was built</a>
        <a href={repo} onClick={closeMenu}>GitHub</a>
        <Link href="/demo" className="lp-isle-cta" onClick={closeMenu}>Try it live</Link>
      </nav>
    </header>
  );
}
