"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The full simulator on your phone, remote style: the phone is one person's own group chat and private texts, the way
// the 2-minute walkthrough pairs a phone. The simulator on the computer keeps playing everyone else. Same group, same
// data, so both screens follow along.

type Person = { id: string; name: string; token: string };
type Msg = { id: string; sender_id: string | null; dm_to: string | null; text: string; game_slug: string | null };
type Card = { title: string; subtitle: string; when: string; spots: string };
type Chat = {
  group: { name: string };
  people: Person[];
  messages: Msg[];
  cards: Record<string, Card>;
  game: { organizerId: string; status: string } | null;
};

const SETUP = "@Assistant Thu 6-8pm Riverside Park courts 3–4, 1200 Riverside Dr, mixed doubles, 3.0-3.5, outdoor, $64";

export default function PlayPhone({ groupId, as }: { groupId: string; as: string | null }) {
  const [chat, setChat] = useState<Chat | null>(null);
  const [me, setMe] = useState<string | null>(as);
  const [thread, setThread] = useState<"group" | "dm">("group");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const seenDm = useRef(0);
  const end = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    // Only a 404 means the group is gone. A dropped request is retried on the next poll.
    const res = await fetch(`/api/play/groups/${groupId}?viewer=${me ?? ""}`, { cache: "no-store" }).catch(() => null);
    if (res?.status === 404) return setError("This demo group has ended. Scan the code in the simulator again.");
    const c = res?.ok ? ((await res.json().catch(() => null)) as Chat | null) : null;
    if (!c) return;
    setChat(c);
    setMe((m) => (m && c.people.some((p) => p.id === m) ? m : (c.game?.organizerId ?? c.people[0]?.id ?? null)));
  }, [groupId, me]);

  useEffect(() => {
    load(); // eslint-disable-line react-hooks/set-state-in-effect -- polls the server; state is set after the fetch resolves
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 4000);
    return () => clearTimeout(t);
  }, [banner]);

  const dms = chat?.messages.filter((m) => m.dm_to && m.dm_to === me) ?? [];
  const group = chat?.messages.filter((m) => !m.dm_to) ?? [];
  useEffect(() => {
    if (thread === "dm") {
      seenDm.current = dms.length;
      setUnread(0); // eslint-disable-line react-hooks/set-state-in-effect -- clears the badge when the tab opens
    } else setUnread(Math.max(0, dms.length - seenDm.current));
  }, [dms.length, thread]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [group.length, dms.length, thread]);

  async function send(body: string) {
    if (!body.trim() || !me || sending) return;
    setSending(true);
    setText("");
    try {
      const r = await fetch(`/api/play/groups/${groupId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senderId: me, text: body }),
      });
      if (!r.ok) throw new Error("not sent");
    } catch {
      // Put the words back so nothing typed is lost, and say why.
      setText(body);
      setBanner("That didn’t send. Try again.");
    } finally {
      setSending(false);
    }
    load();
  }

  if (error) return <main className="dp dp-center"><p className="dp-lead">{error}</p></main>;
  if (!chat || !me) return <main className="dp dp-center"><p className="dp-muted">Connecting…</p></main>;

  const people = new Map(chat.people.map((p) => [p.id, p]));
  const viewer = people.get(me) ?? chat.people[0];
  const hostId = chat.game?.organizerId ?? chat.people[0]?.id;
  const isHost = viewer.id === hostId;
  const linkFor = (slugWithQuery: string) => (slugWithQuery.includes("?o=") ? `/g/${slugWithQuery}` : `/g/${slugWithQuery}?p=${viewer.token}`);
  const list = thread === "group" ? group : dms;

  return (
    <main className="dp sim">
      <header className="dp-top">
        <h1 className="sr-only">Full simulator on your phone</h1>
        <div className="dp-tabs" role="tablist">
          <button role="tab" aria-selected={thread === "group"} className={thread === "group" ? "on" : ""} onClick={() => setThread("group")}>
            {chat.group.name}
          </button>
          <button role="tab" aria-selected={thread === "dm"} className={thread === "dm" ? "on" : ""} onClick={() => setThread("dm")}>
            Assistant{unread > 0 && <span className="dp-dot">{unread}<span className="sr-only"> new</span></span>}
          </button>
        </div>
        <label className="sr-only" htmlFor="pp-as">Who you are</label>
        <select
          id="pp-as"
          className="dp-ctl"
          value={viewer.id}
          onChange={(e) => {
            setMe(e.target.value);
            setThread("group");
            seenDm.current = 0;
            setBanner(`You’re now ${people.get(e.target.value)?.name ?? "someone else"}.`);
          }}
        >
          {chat.people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.id === hostId ? " (host)" : ""}
            </option>
          ))}
        </select>
        <p className="dp-role">
          {isHost ? `You’re ${viewer.name}, the organizer` : `You’re ${viewer.name}, a player`}
          {thread === "dm" ? " · only you see these" : " · the simulator plays everyone else"}
        </p>
      </header>
      {banner && <p className="dp-banner" role="status">{banner}</p>}

      <div className="dp-body" role="log" aria-label={thread === "group" ? "Group chat" : "Private texts from the assistant"}>
        {list.length === 0 && <p className="phone-empty">{thread === "dm" ? "Private texts from the assistant land here." : ""}</p>}
        {list.map((m) => {
          if (!m.sender_id && / was added to the chat$/.test(m.text)) return <p key={m.id} className="im-system">{m.text}</p>;
          const mine = m.sender_id === viewer.id;
          const bot = !m.sender_id;
          const slug = m.game_slug?.split("?")[0];
          const card = slug ? chat.cards[slug] : undefined;
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
          {isHost && chat.game?.status !== "open" && (
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
