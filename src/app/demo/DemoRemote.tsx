"use client";

import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";

type Hold = { status: string; real: boolean; cents: number; captured: number } | null;
type State = {
  groupId: string;
  connected: boolean;
  name: string | null;
  organizer: { name: string };
  viewer: { name: string; role: "organizer" | "player" };
  game: { slug: string; status: string; spots: number; inCount: number; over: boolean; lateWaiting: boolean; playerHold: Hold } | null;
  buyer: { email: string; password: string } | null;
};
type Action = "start" | "friends" | "player" | "organizer" | "late" | "after";

const money = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;

export default function DemoRemote() {
  const [id, setId] = useState<string | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [done, setDone] = useState<Set<Action>>(new Set());

  async function fresh() {
    const r = await fetch("/api/demo", { method: "POST" }).then((x) => x.json());
    try {
      localStorage.setItem("phoneDemo", r.groupId);
    } catch {}
    setDone(new Set());
    setNote(null);
    setState(null);
    setId(r.groupId);
  }

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("phoneDemo");
    } catch {}
    if (saved) setId(saved);
    else fresh();
  }, []);

  const phoneUrl = id && typeof window !== "undefined" ? `${window.location.origin}/demo/${id}/phone` : "";
  useEffect(() => {
    if (phoneUrl) QRCode.toDataURL(phoneUrl, { margin: 1, width: 360, color: { dark: "#1f1a3d", light: "#ffffff" } }).then(setQr);
  }, [phoneUrl]);

  const load = useCallback(async () => {
    if (!id) return;
    const r = await fetch(`/api/demo/${id}`, { cache: "no-store" });
    if (r.status === 404) return fresh();
    if (r.ok) setState(await r.json());
  }, [id]);
  useEffect(() => {
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [load]);

  async function act(action: Action) {
    if (!id) return;
    setBusy(action);
    setNote(null);
    const r = await fetch(`/api/demo/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    const body = await r.json().catch(() => ({}));
    setBusy(null);
    setNote(body.note ?? (r.ok ? "Done." : "That didn’t work."));
    if (r.ok) setDone((d) => new Set(d).add(action));
    load();
  }

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 7000);
    return () => clearTimeout(t);
  }, [note]);

  const g = state?.game;
  const hold = g?.playerHold;
  const connected = !!state?.connected;
  const steps: Array<{ n: number; title: string; body: React.ReactNode; done: boolean; buttons?: Array<{ a: Action; label: string; primary?: boolean; disabled?: boolean }> }> = [
    {
      n: 1,
      title: "Set up the game from your phone",
      body: "Tap the suggested message, or type it your own way. Claude reads it and posts the game to the group. Leave out the time or price and it asks you privately instead.",
      done: !!g,
      buttons: [{ a: "start", label: "Send it for me", disabled: !connected || !!g }],
    },
    {
      n: 2,
      title: "Friends reply the way friends do",
      body: "“yeah I’m down”, “count me in!”. The assistant works out who’s in, and each one places a PayPal hold. Watch the spots fill on your organizer page.",
      done: done.has("friends"),
      buttons: [{ a: "friends", label: "3 friends say they’re in", disabled: !g || g.status !== "open" }],
    },
    {
      n: 3,
      title: "Be a player and hold a spot with PayPal",
      body: (
        <>
          Your phone switches to Jo. Tap the game link, then I’m in. PayPal <strong>authorizes</strong> your share plus a small cap. Nothing is
          charged yet.
          {state?.buyer && (
            <span className="dr-creds">
              Sandbox buyer: <code>{state.buyer.email}</code> · <code>{state.buyer.password}</code>
            </span>
          )}
          {hold && hold.status === "held" && (
            <span className="dr-ok">
              {money(hold.cents)} on hold{hold.real ? " in the PayPal sandbox" : " (simulated)"}.
            </span>
          )}
        </>
      ),
      done: hold?.status === "held" || hold?.status === "captured",
      buttons: [
        { a: "player", label: "Switch my phone to a player", primary: true, disabled: !g || g.status !== "open" || state?.viewer.role === "player" },
        { a: "organizer", label: "Back to organizer", disabled: state?.viewer.role !== "player" },
      ],
    },
    {
      n: 4,
      title: "Someone cancels on game day",
      body: "Free cancel has ended, so their share isn’t released automatically. You decide on your phone: charge it or cover it.",
      done: done.has("late"),
      buttons: [{ a: "late", label: "Someone cancels late", disabled: !g || g.status !== "open" || g.over }],
    },
    {
      n: 5,
      title: "The game ends and it settles itself",
      body: (
        <>
          Each player is <strong>captured</strong> for their real share. The rest of every hold is released. Receipts go out privately.
          {hold && hold.status === "captured" && (
            <span className="dr-ok">
              You were charged {money(hold.captured)} of your {money(hold.cents)} hold{hold.real ? ", captured in the PayPal sandbox" : ""}.
            </span>
          )}
        </>
      ),
      done: g?.status === "settled",
      buttons: [{ a: "after", label: "Skip to after the game", disabled: !g || g.status !== "open" }],
    },
  ];

  return (
    <div className="dr">
      <header className="dr-head">
        <a href="/" className="dr-back">← Pickleball assistant</a>
        <h1>Run a game from your phone</h1>
        <p>
          Your phone is the organizer’s group chat. This page plays everyone else. The assistant (Claude) and your PayPal sandbox hold are
          real; the other players and their holds are simulated.
        </p>
      </header>

      <div className="dr-grid">
        <section className="dr-pair" aria-label="Connect your phone">
          <div className="dr-qr">{qr ? <img src={qr} alt="QR code that opens the demo on your phone" width={240} height={240} /> : <span className="dr-qr-blank" />}</div>
          {connected ? (
            <p className="dr-status on">
              <span className="dr-pulse" aria-hidden="true" /> {state?.name}’s phone is connected
              {state?.viewer.role === "player" ? ` · acting as ${state.viewer.name}` : ""}
            </p>
          ) : (
            <p className="dr-status">Scan with your phone’s camera</p>
          )}
          {g && (
            <p className="dr-meta">
              {g.status === "draft" ? "Waiting on details" : g.status === "settled" ? "Played and settled" : `${g.inCount} of ${g.spots} in`}
            </p>
          )}
          <a className="dr-link" href={phoneUrl} target="pickle-phone" onClick={(e) => {
            e.preventDefault();
            window.open(phoneUrl, "pickle-phone", "width=400,height=860");
          }}>
            No phone handy? Open the phone view in a window
          </a>
          <button className="dr-link" onClick={fresh}>Start over with a new chat</button>
        </section>

        <ol className="dr-steps">
          {steps.map((s) => (
            <li key={s.n} className={s.done ? "done" : ""}>
              <span className="dr-n" aria-hidden="true">{s.done ? "✓" : s.n}</span>
              <div>
                <h2>{s.title}</h2>
                <p>{s.body}</p>
                {s.buttons && (
                  <div className="dr-btns">
                    {s.buttons.map((b) => (
                      <button key={b.a} className={b.primary ? "dr-btn p" : "dr-btn"} disabled={b.disabled || busy !== null} onClick={() => act(b.a)}>
                        {busy === b.a ? "Working…" : b.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
      {note && <p className="dr-note" role="status">{note}</p>}
    </div>
  );
}
