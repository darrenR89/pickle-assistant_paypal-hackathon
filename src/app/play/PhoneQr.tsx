"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

// "Run it on your phone": a QR code for this exact simulator (same group, same chat), like the walkthrough's pairing
// code. Scanning it opens the simulator on the phone; both screens show the same group as it changes.
export default function PhoneQr() {
  const [open, setOpen] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || qr) return;
    QRCode.toDataURL(window.location.href, { margin: 1, width: 400, color: { dark: "#1f1a3d", light: "#ffffff" } }).then(setQr, () => setQr(null));
  }, [open, qr]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  return (
    <div className="sp-phone" ref={box}>
      <button type="button" className="sp-link" aria-expanded={open} aria-controls="sp-phone-pop" onClick={() => setOpen((o) => !o)}>
        On your phone
      </button>
      {open && (
        <div id="sp-phone-pop" className="sp-phone-pop" role="dialog" aria-label="Open this simulator on your phone">
          <strong>Run it on your phone</strong>
          {/* eslint-disable-next-line @next/next/no-img-element -- a generated data: URL, nothing for next/image to optimize */}
          {qr ? <img src={qr} alt="QR code that opens this simulator on your phone" width={200} height={200} /> : <span style={{ display: "block", height: 208 }} />}
          <p>Scan with your phone’s camera. It opens this same group, so both screens follow along.</p>
        </div>
      )}
    </div>
  );
}
