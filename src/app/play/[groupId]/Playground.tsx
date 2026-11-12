"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// A demo simulator of the group chat. Deliberately styled like a device simulator
// (system font, phone frames, a labeled control panel) so it never reads as the product
// itself: in real use the assistant lives in an iMessage or WhatsApp group.

type Person = { id: string; name: string; token: string };
type Msg = { id: string; sender_id: string | null; dm_to: string | null; text: string; game_slug: string | null };
type Card = { title: string; subtitle: string; when: string; spots: string };
type GameInfo = { slug: string; organizerToken: string; organizerId: string; status: string; when: string; inviteOnly: boolean; spots: number; inIds: string[] };
type Data = { group: { name: string }; people: Person[]; messages: Msg[]; cards: Record<string, Card>; game: GameInfo | null };

// Each scenario sends a real message through the real assistant (Claude on the server).
// "as" is who sends it: the organizer, or whoever you're acting as.
type Scenario = { label: string; text: string; as: "organizer" | "me" };
const SCENARIOS: Array<[string, Scenario[]]> = [
  [
    "Start a game (as Alex)",
    [
      { label: "Game with full details", as: "organizer", text: "@Assistant Thu 6-8pm Riverside Park courts 3–4, 1200 Riverside Dr, mixed doubles, 3.0-3.5, outdoor, $64" },
      { label: "Invite-only game", as: "organizer", text: "@Assistant Thu 6pm Riverside Park courts 3–4, $64, mixed doubles, invite only" },
      { label: "Singles: spots → courts", as: "organizer", text: "@Assistant Sat 9am Lincoln Park, singles, 6 spots, $30" },
      { label: "Missing details", as: "organizer", text: "@Assistant let's play Thursday" },
    ],
  ],
  [
    "Say it like a person (as you)",
    [
      { label: "I'm down", as: "me", text: "yeah I'm down" },
      { label: "Maybe", as: "me", text: "maybe, depends if work lets out" },
      { label: "Can't make it", as: "me", text: "ugh I can't make it thursday, sorry all" },
      { label: "Not sure (injury)", as: "me", text: "tweaked my knee, not sure I can play" },
      { label: "Waitlist me", as: "me", text: "waitlist me" },
      { label: "Give spot to Lee", as: "me", text: "can Lee take my spot?" },
      { label: "Bring a friend", as: "me", text: "can my friend Dana come?" },
      { label: "Who's in?", as: "me", text: "who's playing?" },
      { label: "What time?", as: "me", text: "what time is it again?" },
      { label: "Parking? (to host)", as: "me", text: "is there parking near the courts?" },
      { label: "Still on? (to host)", as: "me", text: "rain forecast thursday, are we still on?" },
      { label: "Did I get charged?", as: "me", text: "did I get charged yet?" },
      { label: "Ask to change time", as: "me", text: "can we push it to 7?" },
      { label: "Small talk", as: "me", text: "lol did anyone watch the game last night" },
      { label: "Help", as: "me", text: "what can you do?" },
    ],
  ],
  [
    "Organizer (as Alex)",
    [
      { label: "Add the newest person", as: "organizer", text: "add {newest}" },
      { label: "Move to 7pm", as: "organizer", text: "actually let's push to 7pm" },
      { label: "Call it off", as: "organizer", text: "rained out, cancel the game" },
    ],
  ],
];

export default function Playground({ groupId }: { groupId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [newName, setNewName] = useState("Dana");
  const [note, setNote] = useState<string | null>(null);
  const groupEnd = useRef<HTMLDivElement>(null);
  const dmEnd = useRef<HTMLDivElement>(null);
  const counts = useRef({ group: 0, dm: 0 });

  const load = useCallback(async () => {
    // A dropped request or a server hiccup is retried on the next poll; only a missing group is final.
    const res = await fetch(`/api/play/groups/${groupId}?viewer=${viewerId ?? ""}`, { cache: "no-store" }).catch(() => null);
    if (!res) return;
    const body = await res.json().catch(() => ({}));
    if (res.status === 404) {
      try {
        localStorage.removeItem("playGroup");
      } catch {}
      return setError(body.error ?? "Couldn't load the chat");
    }
    if (!res.ok) return;
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
  const viewer = people.get(viewerId) ?? data.people[0];

  async function sendAs(senderId: string, body: string) {
    setSending(true);
    try {
      const res = await fetch(`/api/play/groups/${groupId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senderId, text: body }),
      });
      if (!res.ok) {
        setNote((await res.json().catch(() => ({}))).error ?? "Couldn't send");
        return false;
      }
    } catch {
      setNote("Couldn't reach the server. Try again.");
      return false;
    } finally {
      setSending(false);
    }
    load();
    return true;
  }

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    if (!text.trim() || sending) return;
    // Keep the words in the box when the message didn't go out.
    if (await sendAs(viewerId!, text)) setText("");
  }

  const organizerId = data.game?.organizerId ?? data.people[0]?.id;
  const newest = [...data.people].reverse().find((p) => !["Alex", "Sam", "Priya", "Jo", "Mei", "Chris", "Lee"].includes(p.name))?.name ?? "Dana";

  async function runScenario(sc: Scenario) {
    const sender = sc.as === "organizer" ? organizerId : viewerId!;
    if (sc.as === "organizer") setViewerId(organizerId);
    setNote(null);
    await sendAs(sender, sc.text.replace("{newest}", newest));
  }

  async function control(body: Record<string, unknown>, done?: (r: Record<string, unknown>) => string) {
    setNote(null);
    const res = await fetch(`/api/play/groups/${groupId}/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!res) {
      setNote("Couldn't reach the server. Try again.");
      return {};
    }
    const r = await res.json().catch(() => ({}));
    await load();
    setNote(res.ok ? (done ? done(r) : "Done.") : (r.error ?? "That didn't work"));
    return r;
  }

  function linkFor(slugWithQuery: string) {
    // ?o= is the organizer's private link; otherwise open the game as the person viewing.
    return slugWithQuery.includes("?o=") ? `/g/${slugWithQuery}` : `/g/${slugWithQuery}?p=${viewer.token}`;
  }

  function bubble(m: Msg, inDm = false) {
    if (!m.sender_id && / was added to the chat$/.test(m.text)) {
      return (
        <p key={m.id} className="im-system">
          {m.text}
        </p>
      );
    }
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
    <main className="sim">
      <h1 className="sr-only">Paddles In demo simulator</h1>
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
            <span className="sim-label">Add someone to the chat</span>
            <form
              className="sim-row"
              onSubmit={async (e) => {
                e.preventDefault();
                const r = await control({ action: "addPerson", name: newName }, () => `${newName} joined the chat. They weren't here when the game was made.`);
                if (r.personId) setViewerId(r.personId as string);
              }}
            >
              <input className="sim-input" value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="Name" maxLength={20} />
              <button className="sim-btn">Add</button>
            </form>
          </div>

          {SCENARIOS.map(([title, list]) => (
            <div key={title} className="sim-field">
              <span className="sim-label">{title}</span>
              <div className="sim-chips">
                {list.map((sc) => (
                  <button key={sc.label} type="button" className="sim-chip" disabled={sending} onClick={() => runScenario(sc)} title={sc.text}>
                    {sc.label.replace("the newest person", newest)}
                  </button>
                ))}
              </div>
            </div>
          ))}

          <div className="sim-field">
            <span className="sim-label">Game {data.game ? (data.game.status === "draft" ? "· not posted yet" : `· ${data.game.when}`) : ""}</span>
            {data.game ? (
              <>
                <a className="sim-btn ghost" href={`/g/${data.game.slug}?p=${viewer.token}`} target="_blank" rel="noreferrer">
                  Open game page as {viewer.name} ↗
                </a>
                <a className="sim-btn ghost" href={`/g/${data.game.slug}?o=${data.game.organizerToken}`} target="_blank" rel="noreferrer">
                  Open organizer page ↗
                </a>
                <button type="button" className="sim-btn ghost" onClick={() => control({ action: "join", personId: viewerId }, () => `${viewer.name} is in with a simulated hold.`)}>
                  Join as {viewer.name} (simulated hold)
                </button>
                <button type="button" className="sim-btn ghost" onClick={() => control({ action: "fill" }, (r) => `Added ${r.added} players with simulated holds. One spot left.`)}>
                  Fill the game, leave 1 spot
                </button>
              </>
            ) : (
              <p className="sim-hint">Start a game first.</p>
            )}
            <p className="sim-hint">Simulated holds skip the PayPal login so you can test quickly. To test real money, open the game page and use a PayPal sandbox account.</p>
          </div>

          <div className="sim-field">
            <span className="sim-label">Move the clock</span>
            <div className="sim-chips">
              {[
                ["before", "3 days out"],
                ["gameday", "Game day"],
                ["soon", "90 min to go"],
                ["over", "After the game"],
              ].map(([mode, label]) => (
                <button key={mode} type="button" className="sim-chip" disabled={!data.game} onClick={() => control({ action: "time", mode }, (r) => `The game is now ${r.label}.`)}>
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="sim-btn ghost"
              disabled={!data.game}
              onClick={() => control({ action: "tick" }, (r) => ((r.ran as string[])?.length ? `Ran: ${(r.ran as string[]).join(", ")}.` : "Nothing was due."))}
            >
              Run scheduled jobs now
            </button>
            <p className="sim-hint">Game day: dropping out becomes a late cancel. 90 min to go + run jobs: game-day reminder. After the game + run jobs: settles up.</p>
          </div>

          {note && (
            <p className="sim-note" role="status">
              {note}
            </p>
          )}

          <button type="button" className="sim-btn ghost" onClick={newGroup}>
            Start a new demo group
          </button>
        </section>

        <section className="phone" aria-label={`Group chat: ${data.group.name}`}>
          <div className="phone-top">
            <span className="phone-title">{data.group.name}</span>
            <span className="phone-sub">{data.people.length} people + Assistant</span>
          </div>
          <div className="phone-body" role="log" aria-label="Group messages">
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
          <div className="phone-body" role="log" aria-label="Private messages">
            {inbox.length ? inbox.map((m) => bubble(m, true)) : <p className="phone-empty">No private texts yet.</p>}
            <div ref={dmEnd} />
          </div>
        </section>
      </div>
    </main>
  );
}
