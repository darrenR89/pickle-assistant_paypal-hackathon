"use client";

import Link from "next/link";
import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import ChatLog, { type Chat } from "./ChatLog";

type Hold = { status: string; real: boolean; cents: number; captured: number } | null;
type State = {
  groupId: string;
  connected: boolean;
  name: string | null;
  organizer: { id: string; name: string };
  organizerToken: string | null;
  viewer: { name: string; role: "organizer" | "player" };
  game: {
    slug: string;
    status: string;
    spots: number;
    inCount: number;
    over: boolean;
    lateWaiting: boolean;
    lateCancel: "pending" | "charged" | "covered" | null;
    lateName: string | null;
    friendsIn: boolean;
    collectedCents: number;
    playerHold: Hold;
  } | null;
  buyer: { email: string; password: string } | null;
  texting: { number: string; code: string | null; linked: boolean } | null;
};
type Action = "start" | "friends" | "player" | "organizer" | "late" | "after" | "text";

const money = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
const prettyPhone = (n: string) => {
  const d = n.replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}` : n;
};

export default function DemoRemote() {
  const [id, setId] = useState<string | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [startErr, setStartErr] = useState<string | null>(null);
  const [chat, setChat] = useState<Chat | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const [textName, setTextName] = useState("");
  const [textPhone, setTextPhone] = useState("");

  async function fresh() {
    setStartErr(null);
    // A failed start (server waking up, network drop) says so instead of leaving an empty QR box.
    const r = await fetch("/api/demo", { method: "POST" }).then((x) => x.json()).catch(() => null);
    if (!r?.groupId) return setStartErr("The demo didn’t start. Tap “Start over with a new chat” to try again.");
    try {
      localStorage.setItem("phoneDemo", r.groupId);
    } catch {}
    setChat(null);
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
    if (!r.ok) return;
    const s: State = await r.json();
    setState(s);
    // Once a phone is connected, this page shows the group chat as the organizer sees it.
    if (s.connected) {
      const c = await fetch(`/api/play/groups/${id}?viewer=${s.organizer.id}`, { cache: "no-store" })
        .then((x) => (x.ok ? x.json() : null))
        .catch(() => null);
      if (c) setChat(c);
    }
  }, [id]);
  useEffect(() => {
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [load]);

  async function act(action: Action, extra: Record<string, string> = {}) {
    if (!id) return;
    setBusy(action);
    setNote(null);
    try {
      const r = await fetch(`/api/demo/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
      const body = await r.json().catch(() => ({}));
      setNote(body.note ?? (r.ok ? "Done." : "That didn’t work."));
    } catch {
      setNote("Couldn’t reach the server. Try again.");
    } finally {
      // Always unlock the buttons, even when the request never got an answer.
      setBusy(null);
    }
    load();
  }

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 7000);
    return () => clearTimeout(t);
  }, [note]);

  const groupMsgs = chat?.messages.filter((m) => !m.dm_to) ?? [];
  useEffect(() => {
    const box = chatEnd.current?.parentElement;
    if (box) box.scrollTop = box.scrollHeight;
  }, [groupMsgs.length]);

  const g = state?.game;
  const open = !!g && g.status === "open";
  const orgLink = g && state?.organizerToken && id ? `/g/${g.slug}?o=${state.organizerToken}&demo=${id}` : null;
  const hold = g?.playerHold;
  const connected = !!state?.connected;
  const texting = state?.texting ?? null;
  const byText = !!texting?.linked;
  const paid = hold?.status === "held" || hold?.status === "captured";
  const late = g?.lateCancel ?? null;
  // Each button is off once its step has happened, read from the game itself so a reload agrees.
  const steps: Array<{ n: number; title: string; body: React.ReactNode; done: boolean; buttons?: Array<{ a: Action; label: string; primary?: boolean; disabled?: boolean }> }> = [
    {
      n: 1,
      title: "Set up the game from your phone",
      body: byText
        ? "Text PaddlesIn from your Messages app, like the example it sent you, or type it your own way. Claude reads it and posts the game to the group, shown here. Replies with real links come back to your phone."
        : "Tap the suggested message, or type it your own way. Claude reads it and posts the game to the group. Leave out the time or price and PaddlesIn asks you privately instead.",
      done: !!g,
      buttons: [{ a: "start", label: "Send it for me", disabled: !connected || !!g }],
    },
    {
      n: 2,
      title: "Friends reply the way friends do",
      body: "“yeah I’m down”, “count me in!”. PaddlesIn works out who’s in, and each one places a PayPal hold. Seven of the eight spots fill, with one left for you.",
      done: !!g?.friendsIn,
      buttons: [{ a: "friends", label: "6 friends say they’re in", disabled: !open || !!g?.friendsIn }],
    },
    {
      n: 3,
      title: "Be a player and hold a spot with PayPal",
      body: (
        <>
          Your phone switches to Jo. Tap the game link, then I’m in. PayPal <strong>authorizes</strong> your share plus a small cap. Nothing is
          charged yet. Use the sandbox login above; PayPal’s sandbox checkout only works on a computer, so open the phone view in a window
          to pay.
          {hold && hold.status === "held" && (
            <span className="dr-ok">
              {money(hold.cents)} on hold{hold.real ? " in the PayPal sandbox" : " (simulated)"}.
            </span>
          )}
        </>
      ),
      done: paid,
      buttons: [
        { a: "player", label: "Switch my phone to a player", primary: true, disabled: !open || state?.viewer.role === "player" || paid },
        { a: "organizer", label: "Back to organizer", disabled: state?.viewer.role !== "player" },
      ],
    },
    {
      n: 4,
      title: "Someone cancels on game day",
      body: (
        <>
          The game fills, then a friend drops out after free cancel, leaving 7 players. Their share isn’t released automatically: the organizer
          gets a private link to charge it or cover it.
          {late === "pending" && orgLink && (
            <span className="dr-ok">
              {g?.lateName} cancelled late. Open your organizer link on your phone, or{" "}
              <a href={orgLink} target="_blank" rel="noreferrer">open it here</a>, to decide.
            </span>
          )}
          {(late === "charged" || late === "covered") && (
            <span className="dr-ok">{late === "charged" ? `You charged ${g?.lateName}’s share.` : `You covered ${g?.lateName}’s share.`}</span>
          )}
        </>
      ),
      done: late === "charged" || late === "covered",
      buttons: [{ a: "late", label: "Someone cancels late", disabled: !open || !!g?.over || !!late }],
    },
    {
      n: 5,
      title: "The game ends and it settles itself",
      body: (
        <>
          Each player is <strong>captured</strong> for their real share. The rest of every hold is released. Receipts go out privately, and the
          organizer sees what was collected.
          {g?.status === "settled" && (
            <span className="dr-ok">
              Settled: {money(g.collectedCents)} collected
              {hold?.status === "captured" ? `, including your ${money(hold.captured)}${hold.real ? " captured in the PayPal sandbox" : ""}` : ""}.
              {orgLink && (
                <>
                  {" "}
                  <a href={orgLink} target="_blank" rel="noreferrer">See the organizer’s summary</a>
                </>
              )}
            </span>
          )}
        </>
      ),
      done: g?.status === "settled",
      buttons: [{ a: "after", label: "Skip to after the game", disabled: !open }],
    },
  ];

  return (
    <main className="dr">
      <header className="dr-head">
        <Link href="/" className="dr-back">← Paddles In</Link>
        <p className="dr-kicker">The 2-minute walkthrough</p>
        <h1>Run a game from your phone</h1>
        <p>
          Your phone is the organizer’s group chat. This page plays everyone else. PaddlesIn (Claude) and your PayPal sandbox hold are
          real; the other players and their holds are simulated.
        </p>
        <p className="dr-alt">
          Want to try every case yourself? <Link href="/play">Open the full simulator →</Link>
        </p>
      </header>

      <section className="dr-sandbox" aria-label="PayPal sandbox login">
        <h2>PayPal sandbox login</h2>
        {state?.buyer ? (
          <p>
            Approve your hold with this test buyer. It’s PayPal’s sandbox, so no real money moves.
            <span className="dr-creds">
              Email <code>{state.buyer.email}</code> · Password <code>{state.buyer.password}</code>
            </span>
          </p>
        ) : (
          <p>
            Approve your hold with any PayPal sandbox personal account (developer.paypal.com → Sandbox accounts). No real money moves.
          </p>
        )}
      </section>

      {phoneUrl && (
        <a className="dr-onphone" href={phoneUrl}>
          <strong>On your phone already?</strong> Open the demo right here. A Demo steps button inside plays the rest of the group. PayPal’s sandbox checkout only works on a computer, so pay from one. →
        </a>
      )}
      <div className="dr-grid">
        <section className="dr-pair" aria-label="Connect your phone">
          {connected && state ? (
            <div className="dr-chat sim" role="log" aria-label="The group chat">
              <p className="dr-chat-top">Thursday crew</p>
              <div className="dr-chat-body">
                <ChatLog
                  chat={chat}
                  list={groupMsgs}
                  viewerId={state.organizer.id}
                  inGroup
                  newTab
                  linkFor={(s) => (s.includes("?o=") ? `/g/${s}&demo=${id}` : `/g/${s}?demo=${id}`)}
                />
                <div ref={chatEnd} />
              </div>
            </div>
          ) : (
            <div className="dr-qr">{qr ? <img src={qr} alt="QR code that opens the demo on your phone" width={240} height={240} /> : <span className="dr-qr-blank" />}</div>
          )}
          {connected ? (
            <p className="dr-status on">
              <span className="dr-pulse" aria-hidden="true" /> {state?.name}’s phone is connected{byText ? " by text" : ""}
              {state?.viewer.role === "player" ? ` · acting as ${state.viewer.name}` : ""}
            </p>
          ) : startErr ? (
            <p className="dr-status" role="alert">{startErr}</p>
          ) : (
            <p className="dr-status">Scan with your phone’s camera</p>
          )}
          {texting && !connected && (
            <div className="dr-text">
              {texting.code ? (
                <>
                  <p>
                    Text <strong>JOIN {texting.code}</strong> to <strong>{prettyPhone(texting.number)}</strong> from the phone you added.
                  </p>
                  <a className="dr-btn p" href={`sms:${texting.number}?&body=${encodeURIComponent(`JOIN ${texting.code}`)}`}>Open Messages</a>
                  <p className="dr-meta">Waiting for your text…</p>
                </>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    act("text", { name: textName, phone: textPhone });
                  }}
                >
                  <p>
                    <strong>Or use your own Messages app.</strong> Text PaddlesIn for real; replies with real links come back to your phone.
                  </p>
                  <label>
                    First name
                    <input value={textName} onChange={(e) => setTextName(e.target.value)} autoComplete="given-name" maxLength={20} required />
                  </label>
                  <label>
                    Mobile number
                    <input value={textPhone} onChange={(e) => setTextPhone(e.target.value)} type="tel" autoComplete="tel" inputMode="tel" required />
                  </label>
                  <button className="dr-btn" disabled={busy !== null}>{busy === "text" ? "Working…" : "Text me instead"}</button>
                </form>
              )}
            </div>
          )}
          {g && (
            <p className="dr-meta">
              {g.status === "draft" ? "Waiting on details" : g.status === "settled" ? "Played and settled" : `${g.inCount} of ${g.spots} in`}
            </p>
          )}
          <a className="dr-link" href={phoneUrl} target="pickle-phone" onClick={(e) => {
            e.preventDefault();
            window.open(phoneUrl, "pickle-phone", "width=470,height=940");
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
    </main>
  );
}
