"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

// "Your phone" in the simulator's messaging panel. The QR code opens this group on a phone as the person you're
// acting as, with their own group chat and private texts, the same remote style as the 2-minute walkthrough. Where
// texting is set up (Sendblue), you can instead pair your real number: add it, text the code, and your own Messages
// app acts as whoever is picked in the simulator.

type Texting = { number: string; code: string | null; linked: boolean } | null;
const prettyPhone = (n: string) => n.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3");

export default function PhoneQr({ groupId, personId, personName }: { groupId: string; personId: string; personName: string }) {
  const [qr, setQr] = useState<{ url: string; img: string } | null>(null);
  const [texting, setTexting] = useState<Texting>(null);
  const [linkedName, setLinkedName] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const path = `/play/${groupId}/phone?as=${encodeURIComponent(personId)}`;

  useEffect(() => {
    const url = `${window.location.origin}${path}`;
    if (qr?.url === url) return;
    QRCode.toDataURL(url, { margin: 1, width: 400, color: { dark: "#1f1a3d", light: "#ffffff" } }).then(
      (img) => setQr({ url, img }),
      () => setQr(null),
    );
  }, [path, qr?.url]);

  // Follow the real-text pairing (the same state the walkthrough page reads).
  useEffect(() => {
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
  }, [groupId]);

  // A phone paired by text acts as the person picked here, so texts from it speak as them and their group chat and
  // private texts come back to it. Pairing makes the phone the organizer, so this runs again once it's linked.
  const linked = !!texting?.linked;
  useEffect(() => {
    if (!linked) return;
    fetch(`/api/play/groups/${groupId}/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "phoneAs", personId }),
    }).catch(() => null);
  }, [groupId, personId, linked]);

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

  const ready = qr && qr.url.endsWith(path);
  return (
    <div className="sp-pair">
      <div className="sp-pair-card">
        <strong>Be {personName} on your phone</strong>
        {/* eslint-disable-next-line @next/next/no-img-element -- a generated data: URL, nothing for next/image to optimize */}
        {ready ? <img src={qr.img} alt={`QR code that opens the group on your phone as ${personName}`} width={180} height={180} /> : <span className="sp-pair-blank" />}
        <p>Scan with your phone’s camera. Your phone becomes {personName}’s group chat and private texts, and this page plays everyone else.</p>
      </div>
      {texting && (
        <div className="sp-pair-card sp-phone-text">
          {texting.linked ? (
            <p>
              <strong>{linkedName ? `${linkedName}’s` : "Your"} phone is connected by text.</strong> Texts from it now speak as {personName}, and {personName}’s group chat, private texts and game links come back to it. Tap someone else above to switch.
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
                <strong>Or use your own Messages app.</strong> Text the assistant for real as {personName}; replies with real links come back to your phone.
              </p>
              <label>
                First name
                <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" maxLength={20} required />
              </label>
              <label>
                Mobile number
                <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" autoComplete="tel" inputMode="tel" required />
              </label>
              <button className="dr-btn p" disabled={busy}>{busy ? "Working…" : "Text me the code"}</button>
              {err && <p className="sp-phone-meta" role="alert">{err}</p>}
            </form>
          )}
        </div>
      )}
    </div>
  );
}
