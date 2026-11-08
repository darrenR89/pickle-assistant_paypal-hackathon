"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Person = { id: string; name: string; token: string };
type Msg = { id: string; sender_id: string | null; dm_to: string | null; text: string; game_slug: string | null };
type Card = { title: string; subtitle: string; when: string; spots: string };
type Data = { group: { name: string }; people: Person[]; messages: Msg[]; cards: Record<string, Card> };

const SUGGESTIONS = ["@Assistant Thu 6pm Riverside courts 3–4, 8 spots, $64", "in", "out"];

export default function Playground({ groupId }: { groupId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const groupEnd = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

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
    if (groupMsgs.length !== lastCount.current) {
      lastCount.current = groupMsgs.length;
      groupEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [groupMsgs.length]);

  if (error) {
    return (
      <main>
        <p className="error">{error}</p>
        <a href="/play">Start a new group</a>
      </main>
    );
  }
  if (!data || !viewerId) return <main className="muted">Loading…</main>;

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
    // A link with ?o= is the organizer's private link; otherwise open it as the person viewing.
    return slugWithQuery.includes("?o=") ? `/g/${slugWithQuery}` : `/g/${slugWithQuery}?p=${viewer.token}`;
  }

  function bubble(m: Msg, inInbox = false) {
    const mine = m.sender_id === viewerId;
    const bot = !m.sender_id;
    const sender = m.sender_id ? people.get(m.sender_id)?.name : "Assistant";
    const slug = m.game_slug?.split("?")[0];
    const card = slug ? data!.cards[slug] : undefined;
    return (
      <div key={m.id} className={`msg ${mine ? "mine" : ""} ${bot ? "bot" : ""}`}>
        {!mine && !inInbox && <span className="sender">{sender}</span>}
        <div className="bubble">
          {m.text}
          {card && m.game_slug && (
            <a className="link-card" href={linkFor(m.game_slug)} target="_blank" rel="noreferrer">
              <span className="link-hero">
                <span className="when">{card.when}</span>
                <span className="spots">{m.game_slug.includes("?o=") ? "organizer" : card.spots}</span>
              </span>
              <span className="link-meta">
                <span className="link-title">{card.title}</span>
                <span className="link-sub">{m.game_slug.includes("?o=") ? "Organizer view · private link" : card.subtitle}</span>
              </span>
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="play">
      <header className="play-head">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="label">Group chat playground</span>
          <span className="name">{data.group.name}</span>
        </div>
        <div className="personas">
          <span className="label" style={{ marginRight: 4 }}>
            Viewing as
          </span>
          {data.people.map((p) => (
            <button key={p.id} className={p.id === viewerId ? "persona on" : "persona"} onClick={() => setViewerId(p.id)}>
              {p.name}
            </button>
          ))}
        </div>
      </header>

      <section className="thread">
        <div className="thread-body">
          {groupMsgs.map((m) => bubble(m))}
          <div ref={groupEnd} />
        </div>
        <div className="suggestions">
          {SUGGESTIONS.map((s) => (
            <button key={s} className="suggestion" onClick={() => setText(s)}>
              {s}
            </button>
          ))}
        </div>
        <form className="composer" onSubmit={send}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Message as ${viewer.name}`}
            maxLength={500}
          />
          <button disabled={sending || !text.trim()}>Send</button>
        </form>
      </section>

      <aside className="inbox">
        <span className="label">Private messages</span>
        <p className="inbox-title">{viewer.name}&apos;s inbox</p>
        <p className="muted small" style={{ marginTop: 0 }}>
          Money details only ever arrive here, never in the group.
        </p>
        {inbox.length ? inbox.map((m) => bubble(m, true)) : <p className="muted small">Nothing yet.</p>}
      </aside>
    </div>
  );
}
