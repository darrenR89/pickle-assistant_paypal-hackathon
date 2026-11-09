"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// A demo simulator of the group chat. Deliberately styled like a device simulator
// (system font, phone frames, a labeled control panel) so it never reads as the product
// itself: in real use the assistant lives in an iMessage or WhatsApp group.

type Person = { id: string; name: string; token: string };
type Msg = { id: string; sender_id: string | null; dm_to: string | null; text: string; game_slug: string | null };
type Card = { title: string; subtitle: string; when: string; spots: string };
type Data = { group: { name: string }; people: Person[]; messages: Msg[]; cards: Record<string, Card> };

const QUICK = [
  { label: "Create a game", text: "@Assistant Thu 6-8pm Riverside Park courts 3–4, 1200 Riverside Dr, mixed doubles, 3.0-3.5, outdoor, $64" },
  { label: "Say in", text: "in" },
  { label: "Say out", text: "out" },
];

export default function Playground({ groupId }: { groupId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const groupEnd = useRef<HTMLDivElement>(null);
  const dmEnd = useRef<HTMLDivElement>(null);
  const counts = useRef({ group: 0, dm: 0 });

  const load = useCallback(async () => {
    const res = await fetch(`/api/play/groups/${groupId}?viewer=${viewerId ?? ""}`, { cache: "no-store" });
    const body = await res.json();
    if (!res.ok) {
      if (res.status === 404) {
        try {
          localStorage.removeItem("playGroup");
        } catch {}
      }
      return setError(body.error ?? "Couldn't load the chat");
    }
    setData(body);
    setViewerId((v) => v ?? body.people[0]?.id ?? null);
  }, [groupId, viewerId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [load]);

  const groupMsgs = data?.messages.filter((m) => !m.dm_to) ?? [];
  const inbox = data?.messages.filter((m) => m.dm_to && m.dm_to === viewerId) ?? [];

  useEffect(() => {
    if (groupMsgs.length !== counts.current.group) {
      counts.current.group = groupMsgs.length;
      groupEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
    if (inbox.length !== counts.current.dm) {
      counts.current.dm = inbox.length;
      dmEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [groupMsgs.length, inbox.length]);

  function newGroup() {
    try {
      localStorage.removeItem("playGroup");
    } catch {}
    window.location.href = "/play";
  }

  if (error) {
    return (
      <div className="sim">
        <div className="sim-banner">Demo simulator</div>
        <p className="sim-error">{error}</p>
        <button type="button" className="sim-btn" onClick={newGroup}>
          Start a new demo group
        </button>
      </div>
    );
  }
  if (!data || !viewerId) return <div className="sim">Loading simulator…</div>;

  const people = new Map(data.people.map((p) => [p.id, p]));
  const viewer = people.get(viewerId)!;

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    const res = await fetch(`/api/play/groups/${groupId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senderId: viewerId, text }),
    });
    setSending(false);
    if (!res.ok) return setError((await res.json()).error ?? "Couldn't send");
    setText("");
    load();
  }

  function linkFor(slugWithQuery: string) {
    // ?o= is the organizer's private link; otherwise open the game as the person viewing.
    return slugWithQuery.includes("?o=") ? `/g/${slugWithQuery}` : `/g/${slugWithQuery}?p=${viewer.token}`;
  }

  function bubble(m: Msg, inDm = false) {
    const mine = m.sender_id === viewerId;
    const bot = !m.sender_id;
    const sender = m.sender_id ? people.get(m.sender_id)?.name : "Assistant";
    const slug = m.game_slug?.split("?")[0];
    const card = slug ? data!.cards[slug] : undefined;
    return (
      <div key={m.id} className={`im-msg ${mine ? "mine" : ""} ${bot ? "bot" : ""}`}>
        {!mine && !inDm && <span className="im-sender">{sender}</span>}
        <div className="im-bubble">
          {m.text}
          {card && m.game_slug && (
            <a className="im-link" href={linkFor(m.game_slug)} target="_blank" rel="noreferrer">
              <span className="im-link-hero">
                <span className="when">{card.when}</span>
                <span className="spots">{m.game_slug.includes("?o=") ? "organizer" : card.spots}</span>
              </span>
              <span className="im-link-meta">
                <span className="im-link-title">{card.title}</span>
                <span className="im-link-sub">
                  {m.game_slug.includes("?o=") ? "Organizer view · private link" : `${card.subtitle} · pickle-assistant.onrender.com`}
                </span>
              </span>
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="sim">
      <div className="sim-banner" role="note">
        <strong>Demo simulator.</strong> These chats are simulated so you can try the assistant without a real group. In real use it
        lives in your iMessage or WhatsApp group. The PayPal and Venmo holds are real sandbox transactions.
      </div>

      <div className="sim-grid">
        <section className="sim-panel" aria-label="Simulator controls">
          <span className="sim-kicker">Simulator controls</span>
          <div className="sim-field">
            <span className="sim-label">Act as</span>
            <div className="sim-people">
              {data.people.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={p.id === viewerId ? "sim-person on" : "sim-person"}
                  aria-pressed={p.id === viewerId}
                  onClick={() => setViewerId(p.id)}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
          <div className="sim-field">
            <span className="sim-label">Quick messages</span>
            {QUICK.map((q) => (
              <button key={q.label} type="button" className="sim-btn ghost" onClick={() => setText(q.text)}>
                {q.label}
              </button>
            ))}
          </div>
          <div className="sim-field">
            <span className="sim-label">Try this</span>
            <ol className="sim-steps">
              <li>As Alex, create a game.</li>
              <li>Switch to Sam and say &quot;in&quot;.</li>
              <li>Tap the card and approve the hold with a PayPal sandbox account.</li>
              <li>Watch the group and each private thread update.</li>
            </ol>
          </div>
          <button type="button" className="sim-btn ghost" onClick={newGroup}>
            Start a new demo group
          </button>
        </section>

        <section className="phone" aria-label={`Group chat: ${data.group.name}`}>
          <div className="phone-top">
            <span className="phone-title">{data.group.name}</span>
            <span className="phone-sub">{data.people.length} people + Assistant</span>
          </div>
          <div className="phone-body">
            {groupMsgs.map((m) => bubble(m))}
            <div ref={groupEnd} />
          </div>
          <form className="phone-compose" onSubmit={send}>
            <label className="sr-only" htmlFor="compose">
              Message as {viewer.name}
            </label>
            <input
              id="compose"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={`iMessage as ${viewer.name}`}
              maxLength={500}
            />
            <button type="submit" disabled={sending || !text.trim()} aria-label="Send">
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </form>
        </section>

        <section className="phone" aria-label={`${viewer.name}'s private texts with the Assistant`}>
          <div className="phone-top">
            <span className="phone-title">Assistant</span>
            <span className="phone-sub">{viewer.name}&apos;s private texts · money details only arrive here</span>
          </div>
          <div className="phone-body">
            {inbox.length ? inbox.map((m) => bubble(m, true)) : <p className="phone-empty">No private texts yet.</p>}
            <div ref={dmEnd} />
          </div>
        </section>
      </div>
    </div>
  );
}
