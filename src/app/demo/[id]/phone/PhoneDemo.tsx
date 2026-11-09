"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Person = { id: string; name: string; token: string };
type Msg = { id: string; sender_id: string | null; dm_to: string | null; text: string; game_slug: string | null };
type Card = { title: string; subtitle: string; when: string; spots: string };
type Chat = { people: Person[]; messages: Msg[]; cards: Record<string, Card> };
type State = {
  connected: boolean;
  name: string | null;
  viewer: { id: string; name: string; token: string; role: "organizer" | "player" };
  game: { slug: string; status: string } | null;
};

const SETUP = "@Assistant Thu 6-8pm Riverside Park courts 3–4, 1200 Riverside Dr, mixed doubles, 3.0-3.5, $64";

export default function PhoneDemo({ id }: { id: string }) {
  const [state, setState] = useState<State | null>(null);
  const [chat, setChat] = useState<Chat | null>(null);
  const [thread, setThread] = useState<"group" | "dm">("group");
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const lastViewer = useRef<string | null>(null);
  const seenDm = useRef(0);
  const [unread, setUnread] = useState(0);
  const end = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const s = await fetch(`/api/demo/${id}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null));
    if (!s) return setError("This demo has ended. Scan the code on the demo page again.");
    setState(s);
    if (lastViewer.current && lastViewer.current !== s.viewer.id) {
      setBanner(s.viewer.role === "organizer" ? "You’re the organizer again." : `You’re now ${s.viewer.name}, a player in the group.`);
      setThread("group");
    }
    lastViewer.current = s.viewer.id;
    if (!s.connected) return;
    const c = await fetch(`/api/play/groups/${id}?viewer=${s.viewer.id}`, { cache: "no-store" }).then((r) => r.json());
    setChat(c);
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 4000);
    return () => clearTimeout(t);
  }, [banner]);

  const dms = chat?.messages.filter((m) => m.dm_to) ?? [];
  const group = chat?.messages.filter((m) => !m.dm_to) ?? [];
  useEffect(() => {
    if (thread === "dm") {
      seenDm.current = dms.length;
      setUnread(0);
    } else setUnread(Math.max(0, dms.length - seenDm.current));
  }, [dms.length, thread]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [group.length, dms.length, thread]);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSending(true);
    const r = await fetch(`/api/demo/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "connect", name }) });
    setSending(false);
    if (!r.ok) return setError((await r.json()).note ?? "Couldn’t connect");
    load();
  }

  async function send(body: string) {
    if (!body.trim() || !state || sending) return;
    setSending(true);
    setText("");
    await fetch(`/api/play/groups/${id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senderId: state.viewer.id, text: body }),
    });
    setSending(false);
    load();
  }

  if (error) return <main className="dp dp-center"><p className="dp-lead">{error}</p></main>;
  if (!state) return <main className="dp dp-center"><p className="dp-muted">Connecting…</p></main>;

  if (!state.connected)
    return (
      <main className="dp dp-center">
        <form className="dp-join" onSubmit={connect}>
          <span className="dp-kicker">Pickleball assistant · live demo</span>
          <h1 className="dp-h1">You’re organizing Thursday’s game.</h1>
          <p className="dp-lead">
            This phone becomes your group chat. Set up a game, and the demo page plays your friends. Everything the assistant says is
            live, and paying uses the real PayPal sandbox.
          </p>
          <label className="dp-label">
            Your first name
            <input className="dp-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" maxLength={20} autoFocus required />
          </label>
          <button className="dp-btn" disabled={sending}>Open the group chat</button>
        </form>
      </main>
    );

  const people = new Map((chat?.people ?? []).map((p) => [p.id, p]));
  const viewer = state.viewer;
  const linkFor = (slugWithQuery: string) =>
    slugWithQuery.includes("?o=") ? `/g/${slugWithQuery}&demo=${id}` : `/g/${slugWithQuery}?p=${viewer.token}&demo=${id}`;
  const list = thread === "group" ? group : dms;

  return (
    <main className="dp sim">
      <header className="dp-top">
        <div className="dp-tabs" role="tablist">
          <button role="tab" aria-selected={thread === "group"} className={thread === "group" ? "on" : ""} onClick={() => setThread("group")}>
            Thursday crew
          </button>
          <button role="tab" aria-selected={thread === "dm"} className={thread === "dm" ? "on" : ""} onClick={() => setThread("dm")}>
            Assistant{unread > 0 && <span className="dp-dot" aria-label={`${unread} new`}>{unread}</span>}
          </button>
        </div>
        <p className="dp-role">
          {viewer.role === "organizer" ? `You’re ${viewer.name}, the organizer` : `You’re ${viewer.name}, a player`}
          {thread === "dm" && " · only you see these"}
        </p>
      </header>
      {banner && <p className="dp-banner" role="status">{banner}</p>}

      <div className="dp-body">
        {list.length === 0 && <p className="phone-empty">{thread === "dm" ? "Private texts from the assistant land here." : ""}</p>}
        {list.map((m) => {
          if (!m.sender_id && / was added to the chat$/.test(m.text)) return <p key={m.id} className="im-system">{m.text}</p>;
          const mine = m.sender_id === viewer.id;
          const bot = !m.sender_id;
          const slug = m.game_slug?.split("?")[0];
          const card = slug ? chat?.cards[slug] : undefined;
          const org = m.game_slug?.includes("?o=");
          return (
            <div key={m.id} className={`im-msg ${mine ? "mine" : ""} ${bot ? "bot" : ""}`}>
              {!mine && thread === "group" && <span className="im-sender">{m.sender_id ? people.get(m.sender_id)?.name : "Assistant"}</span>}
              <div className="im-bubble">
                {m.text}
                {card && m.game_slug && (
                  <a className="im-link" href={linkFor(m.game_slug)}>
                    <span className="im-link-hero">
                      <span className="when">{card.when}</span>
                      <span className="spots">{org ? "organizer" : card.spots}</span>
                    </span>
                    <span className="im-link-meta">
                      <span className="im-link-title">{card.title}</span>
                      <span className="im-link-sub">{org ? "Organizer view · private link" : card.subtitle}</span>
                    </span>
                  </a>
                )}
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>

      {thread === "group" && (
        <div className="dp-foot">
          {viewer.role === "organizer" && !state.game && (
            <button className="dp-suggest" disabled={sending} onClick={() => send(SETUP)}>
              <span>Suggested</span>
              {SETUP}
            </button>
          )}
          <form
            className="dp-compose"
            onSubmit={(e) => {
              e.preventDefault();
              send(text);
            }}
          >
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="iMessage" aria-label="Message the group" enterKeyHint="send" />
            <button aria-label="Send" disabled={sending || !text.trim()}>↑</button>
          </form>
        </div>
      )}
    </main>
  );
}
