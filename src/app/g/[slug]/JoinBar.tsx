"use client";

import { useEffect, useState } from "react";

/** Floating "I'm in" bar. It steps aside once the join card itself is on screen. */
export default function JoinBar({ price, left }: { price: string; left: number }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const card = document.getElementById("join");
    if (!card || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([e]) => setHidden(e.isIntersecting), { threshold: 0.35 });
    io.observe(card);
    return () => io.disconnect();
  }, []);
  if (hidden) return null;
  return (
    <div className="float-bar">
      <div>
        <span className="float-price">
          {price} <span>· {left} spot{left === 1 ? "" : "s"} left</span>
        </span>
        <span className="float-sub">Held now, charged after</span>
      </div>
      <a className="button" href="#join">
        I&apos;m in
      </a>
    </div>
  );
}
