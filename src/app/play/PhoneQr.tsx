"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

// "Run it on your phone", remote style like the 2-minute walkthrough: the QR code opens this group on a phone as the
// person you're acting as, with their own group chat and private texts. This page keeps playing everyone else.
export default function PhoneQr({ groupId, personId, personName }: { groupId: string; personId: string; personName: string }) {
  const [open, setOpen] = useState(false);
  const [qr, setQr] = useState<{ url: string; img: string } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const path = `/play/${groupId}/phone?as=${encodeURIComponent(personId)}`;

  useEffect(() => {
    if (!open) return;
    const url = `${window.location.origin}${path}`;
    if (qr?.url === url) return;
    QRCode.toDataURL(url, { margin: 1, width: 400, color: { dark: "#1f1a3d", light: "#ffffff" } }).then(
      (img) => setQr({ url, img }),
      () => setQr(null),
    );
  }, [open, path, qr?.url]);

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

  const ready = qr && qr.url.endsWith(path);
  return (
    <div className="sp-phone" ref={box}>
      <button type="button" className="sp-link" aria-expanded={open} aria-controls="sp-phone-pop" onClick={() => setOpen((o) => !o)}>
        On your phone
      </button>
      {open && (
        <div id="sp-phone-pop" className="sp-phone-pop" role="dialog" aria-label={`Be ${personName} on your phone`}>
          <strong>Be {personName} on your phone</strong>
          {/* eslint-disable-next-line @next/next/no-img-element -- a generated data: URL, nothing for next/image to optimize */}
          {ready ? <img src={qr.img} alt={`QR code that opens the group on your phone as ${personName}`} width={200} height={200} /> : <span style={{ display: "block", height: 208 }} />}
          <p>Scan with your phone’s camera. Your phone becomes {personName}’s group chat and private texts; this page plays everyone else. Pick someone else first to be them instead.</p>
          <a href={path} target="_blank" rel="noreferrer">No phone handy? Open the phone view in a window</a>
        </div>
      )}
    </div>
  );
}
