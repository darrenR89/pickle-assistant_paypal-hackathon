"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

// "Run it on your phone", remote style like the 2-minute walkthrough: the QR code opens this group on a phone as the
// person you're acting as, with their own group chat and private texts. This page keeps playing everyone else.
// Or, where texting is set up (Sendblue), the same real-text pairing as the walkthrough: add your number, text the
// code, and you're the organizer in your own Messages app.

type Texting = { number: string; code: string | null; linked: boolean } | null;
const prettyPhone = (n: string) => n.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3");
export default function PhoneQr({ groupId, personId, personName }: { groupId: string; personId: string; personName: string }) {
  const [open, setOpen] = useState(false);
  const [qr, setQr] = useState<{ url: string; img: string } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [texting, setTexting] = useState<Texting>(null);
  const [linkedName, setLinkedName] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
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

  // While open, follow the real-text pairing (the same state the walkthrough page reads).
  useEffect(() => {
    if (!open) return;
    let live = true;
    const read = async () => {
      const r = await fetch(`/api/demo/${groupId}`, { cache: "no-store" }).catch(() => null);
      const b = r?.ok ? await r.json().catch(() => null) : null;
      if (!live || !b) return;
      setTexting(b.texting ?? null);
      setLinkedName(b.name ?? null);
    };
    read();
    const t = setInterval(read, 3000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [open, groupId]);

  async function textMe(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/demo/${groupId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "text", name, phone }) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) setErr(b.note ?? "That didn’t work. Try again.");
      else {
        const st = await fetch(`/api/demo/${groupId}`, { cache: "no-store" }).then((x) => x.json()).catch(() => null);
        if (st?.texting) setTexting(st.texting);
      }
    } catch {
      setErr("Couldn’t reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

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
          {texting && (
            <div className="sp-phone-text">
              {texting.linked ? (
                <p>
                  <strong>{linkedName ?? "Your"} phone is connected by text.</strong> You’re the organizer in your own Messages app; replies and game links come back as texts.
                </p>
              ) : texting.code ? (
                <>
                  <p>
                    Text <strong>JOIN {texting.code}</strong> to <strong>{prettyPhone(texting.number)}</strong> from the phone you added.
                  </p>
                  <a className="dr-btn p" href={`sms:${texting.number}?&body=${encodeURIComponent(`JOIN ${texting.code}`)}`}>Open Messages</a>
                  <p className="sp-phone-meta">Waiting for your text…</p>
                </>
              ) : (
                <form onSubmit={textMe}>
                  <p>
                    <strong>Or use your own Messages app.</strong> Text the assistant for real as the organizer; replies with real links come back to your phone.
                  </p>
                  <label>
                    First name
                    <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" maxLength={20} required />
                  </label>
                  <label>
                    Mobile number
                    <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" autoComplete="tel" inputMode="tel" required />
                  </label>
                  <button className="dr-btn" disabled={busy}>{busy ? "Working…" : "Text me instead"}</button>
                  {err && <p className="sp-phone-meta" role="alert">{err}</p>}
                </form>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
