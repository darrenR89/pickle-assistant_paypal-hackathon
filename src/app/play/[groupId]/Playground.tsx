"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SimShell from "../SimShell";
import StatusBar from "../../landing/StatusBar";

// A demo simulator of the group chat. It runs full screen on the landing page's mesh (SimShell) with the controls in a
// bar across the top; the two phones keep an iMessage look, because in real use the assistant lives in a group chat.

type Person = { id: string; name: string; token: string };
type Msg = { id: string; sender_id: string | null; dm_to: string | null; text: string; game_slug: string | null };
type Card = { title: string; subtitle: string; when: string; spots: string };
type GameInfo = { slug: string; organizerToken: string; organizerId: string; status: string; when: string; inviteOnly: boolean; spots: number; inIds: string[]; clockOffsetMs: number };
type Data = { group: { name: string }; people: Person[]; messages: Msg[]; cards: Record<string, Card>; game: GameInfo | null };

// Each sample sends a real message through the real assistant (Claude on the server), always as the person you're
// acting as. The host's samples only show when you act as the host, and players' samples only when you act as a player.
type Sample = { label: string; text: string };
const START: Sample[] = [
  { label: "Game with full details", text: "@Assistant Thu 6-8pm Riverside Park courts 3–4, 1200 Riverside Dr, mixed doubles, 3.0-3.5, outdoor, $64" },
  { label: "Invite-only game", text: "@Assistant Thu 6pm Riverside Park courts 3–4, $64, mixed doubles, invite only" },
  { label: "Singles: spots → courts", text: "@Assistant Sat 9am Lincoln Park, singles, 6 spots, $30" },
  { label: "Missing details", text: "@Assistant let's play Thursday" },
];
const HOST: Sample[] = [
  { label: "Move to 7pm", text: "actually let's push to 7pm" },
  { label: "Call it off", text: "rained out, cancel the game" },
];
const PLAYER: Sample[] = [
  { label: "I'm down", text: "yeah I'm down" },
  { label: "Maybe", text: "maybe, depends if work lets out" },
  { label: "Can't make it", text: "ugh I can't make it thursday, sorry all" },
  { label: "Not sure (injury)", text: "tweaked my knee, not sure I can play" },
  { label: "Waitlist me", text: "waitlist me" },
  { label: "Give spot to Lee", text: "can Lee take my spot?" },
  { label: "Bring a friend", text: "can my friend Dana come?" },
  { label: "Who's in?", text: "who's playing?" },
  { label: "What time?", text: "what time is it again?" },
  { label: "Parking? (to host)", text: "is there parking near the courts?" },
  { label: "Still on? (to host)", text: "rain forecast thursday, are we still on?" },
  { label: "Did I get charged?", text: "did I get charged yet?" },
  { label: "Ask to change time", text: "can we push it to 7?" },
  { label: "Small talk", text: "lol did anyone watch the game last night" },
  { label: "Help", text: "what can you do?" },
];

// The simulator's time, in the game's time zone: the phones' status bars and the clock label show it.
const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", ...opts });
const phoneTime = fmt({ hour: "numeric", minute: "2-digit" });
const dayTime = fmt({ weekday: "short", hour: "numeric", minute: "2-digit" });

// The clock scenarios, in order: where the game stands and what that stage tests.
const CLOCK: Array<[string, string, string]> = [
  ["week", "A week out", "Delayed hold"],
  ["before", "Days out", "Free cancel"],
  ["gameday", "Game day", "Drops are late"],
  ["soon", "90 min to go", "Reminder"],
  ["over", "After", "Settle up"],
];

export default function Playground({ groupId }: { groupId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [newName, setNewName] = useState("Dana");
  const [note, setNote] = useState<string | null>(null);
  const [pick, setPick] = useState("");
  const [clock, setClock] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [running, setRunning] = useState<{ id: string; step: string } | null>(null);
  const groupBody = useRef<HTMLDivElement>(null);
  const dmBody = useRef<HTMLDivElement>(null);
  const counts = useRef({ group: 0, dm: 0 });
  // The real time at the last poll; the simulator's time is this plus the game's clock offset.
  const [realNow, setRealNow] = useState(() => Date.now());

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
    setRealNow(Date.now());
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
      // Scroll the chat itself, not the page: scrollIntoView would also jump the window on stacked layouts.
      groupBody.current?.scrollTo({ top: groupBody.current.scrollHeight, behavior: "smooth" });
    }
    if (inbox.length !== counts.current.dm) {
      counts.current.dm = inbox.length;
      dmBody.current?.scrollTo({ top: dmBody.current.scrollHeight, behavior: "smooth" });
    }
  }, [groupMsgs.length, inbox.length]);

  // The note is a toast: it clears itself after a few seconds.
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 6000);
    return () => clearTimeout(t);
  }, [note]);

  function newGroup() {
    try {
      localStorage.removeItem("playGroup");
    } catch {}
    window.location.href = "/play";
  }

  if (error) {
    return (
      <SimShell>
        <div className="sp-body">
          <p className="sp-status err" role="alert">{error}</p>
          <button type="button" className="dr-btn p" onClick={newGroup}>
            Start a new demo group
          </button>
        </div>
      </SimShell>
    );
  }
  if (!data || !viewerId)
    return (
      <SimShell>
        <div className="sp-body">
          <p className="sp-status" role="status">Loading the simulator…</p>
        </div>
      </SimShell>
    );

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
  async function runSample(sc: Sample) {
    setNote(null);
    await sendAs(viewerId!, sc.text);
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

  // Moving the clock also runs what the scheduled job would do at that time (reminders, settle-up), so there is no
  // separate step: on the live app that job runs every 10 minutes on its own.
  async function moveTo(mode: string) {
    const t = await control({ action: "time", mode }, (r) => `The game is now ${r.label}.`);
    if (!t.label) return;
    setClock(mode);
    await control({ action: "tick" }, (r) => {
      const ran = (r.ran as string[] | undefined) ?? [];
      return `The game is now ${t.label}.${ran.length ? ` ${ran.join(", ")}.` : ""}`;
    });
  }

  // ---- Game scenarios: each one chains the same messages and testing shortcuts you could do by hand ----

  // Re-reads the group so a scenario's next step sees what the last one changed.
  async function fresh(): Promise<Data | null> {
    const res = await fetch(`/api/play/groups/${groupId}?viewer=${viewerId ?? ""}`, { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return null;
    const body = (await res.json().catch(() => null)) as Data | null;
    if (body) setData(body);
    return body;
  }
  async function post(body: Record<string, unknown>) {
    const res = await fetch(`/api/play/groups/${groupId}/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    return ((await res?.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  }
  const hostOf = (d: Data) => d.game?.organizerId ?? d.people[0].id;
  const named = (d: Data, name: string, fallback: number) => d.people.find((p) => p.name === name)?.id ?? d.people[fallback]?.id ?? d.people[0].id;
  async function personNamed(d: Data, name: string) {
    const have = d.people.find((p) => p.name === name);
    if (have) return have.id;
    const r = await post({ action: "addPerson", name });
    return (r.personId as string) ?? d.people[0].id;
  }
  // Someone who is playing (not the host), preferring the named person, so a scenario still works after earlier ones.
  function playing(d: Data, prefer: string) {
    const host = hostOf(d);
    const ins = d.people.filter((p) => p.id !== host && d.game?.inIds.includes(p.id));
    return (ins.find((p) => p.name === prefer) ?? ins[0] ?? d.people[1] ?? d.people[0]).id;
  }
  // Someone in the chat who isn't playing yet, added to the chat if needed.
  async function notPlaying(d: Data, names: string[]) {
    for (const n of names) {
      const p = d.people.find((x) => x.name === n);
      if (!p) return { id: await personNamed(d, n), name: n };
      if (!d.game?.inIds.includes(p.id)) return { id: p.id, name: n };
    }
    const n = `${names[0]} ${d.people.length}`;
    return { id: await personNamed(d, n), name: n };
  }
  // Every scenario needs an open game: if there isn't one, the host posts the full-details setup first.
  async function openGame(step: (s: string) => void) {
    let d = await fresh();
    if (!d) throw new Error("Couldn't load the chat");
    if (d.game?.status !== "open") {
      step("The host posts a new game");
      await sendAs(hostOf(d), START[0].text);
      d = await fresh();
      if (!d || d.game?.status !== "open") throw new Error("The game didn't open. Try “Start a new demo group”.");
    }
    return d;
  }
  async function clockTo(mode: string) {
    await post({ action: "time", mode });
    await post({ action: "tick" });
    setClock(mode);
  }

  // A scenario that ends on the host's side switches who you act as, and its note says so.
  function actAsHost(d: Data) {
    const id = hostOf(d);
    setViewerId(id);
    return `You're now acting as ${d.people.find((p) => p.id === id)?.name ?? "the host"}`;
  }

  type GameScenario = { id: string; title: string; body: string; run: (step: (s: string) => void) => Promise<string> };
  const GAME_SCENARIOS: GameScenario[] = [
    {
      id: "race",
      title: "Last spot and a waitlist",
      body: "The game fills, a newcomer grabs the last spot and the next one joins the waitlist.",
      run: async (step) => {
        const d = await openGame(step);
        step("Filling the game");
        await post({ action: "fill" });
        const first = await notPlaying(d, ["Dana", "Robin", "Taylor"]);
        step(`${first.name} takes the last spot`);
        await post({ action: "join", personId: first.id });
        const late = await notPlaying((await fresh()) ?? d, ["Kai", "Morgan", "Jamie"]);
        step(`${late.name} asks for the waitlist`);
        await sendAs(late.id, "waitlist me");
        return `The game is full and ${late.name} is on the waitlist, first in line if a spot opens.`;
      },
    },
    {
      id: "late",
      title: "Late cancel",
      body: "The game is full with one on the waitlist. On game day a player drops out; the host charges, covers, or waits for a replacement.",
      run: async (step) => {
        const d = await openGame(step);
        step("Filling the game");
        await post({ action: "fill" });
        const last = await notPlaying(d, ["Dana", "Robin", "Taylor"]);
        await post({ action: "join", personId: last.id });
        const next = await notPlaying((await fresh()) ?? d, ["Kai", "Morgan", "Jamie"]);
        step(`${next.name} joins the waitlist`);
        await sendAs(next.id, "waitlist me");
        step("Moving to game day");
        await clockTo("gameday");
        const f = (await fresh()) ?? d;
        const who = playing(f, "Sam");
        const name = people.get(who)?.name ?? f.people.find((p) => p.id === who)?.name ?? "A player";
        step(`${name} drops out`);
        await sendAs(who, "ugh I can't make it thursday, sorry all");
        return `${name} cancelled after free cancel ended. ${actAsHost(d)}: charge, cover, or wait on the organizer page. Then act as ${next.name} and join: ${name} is let off.`;
      },
    },
    {
      id: "handoff",
      title: "Hand a spot to a friend",
      body: "A player can't come and offers their spot to a friend who isn't playing yet.",
      run: async (step) => {
        const d = await openGame(step);
        step("Filling the game");
        await post({ action: "fill" });
        const friend = await notPlaying(d, ["Dana", "Robin", "Taylor"]);
        const f = (await fresh()) ?? d;
        const who = playing(f, "Sam");
        const name = f.people.find((p) => p.id === who)?.name ?? "A player";
        step(`${name} offers the spot to ${friend.name}`);
        await sendAs(who, `can ${friend.name} take my spot?`);
        return `${name} offered the spot to ${friend.name}. The claim link is in the group chat.`;
      },
    },
    {
      id: "host",
      title: "Questions for the host",
      body: "Priya asks about parking and Jo about rain. Both go to the host, not the whole group.",
      run: async (step) => {
        const d = await openGame(step);
        step("Priya asks about parking");
        await sendAs(named(d, "Priya", 2), "is there parking near the courts?");
        step("Jo asks about rain");
        await sendAs(named(d, "Jo", 3), "rain forecast thursday, are we still on?");
        return `Both questions went to the host privately. ${actAsHost(d)} to show them.`;
      },
    },
    {
      id: "rain",
      title: "Rained out",
      body: "The game fills, then the host calls it off. Once they confirm, every hold is released.",
      run: async (step) => {
        const d = await openGame(step);
        step("Filling the game");
        await post({ action: "fill" });
        step("The host calls it off");
        await sendAs(hostOf(d), "rained out, cancel the game");
        return `${actAsHost(d)}. They're asked to confirm on the organizer page, which releases every hold.`;
      },
    },
    {
      id: "settle",
      title: "Play it and settle up",
      body: "The game fills, the game-day reminder goes out, and after the game everyone pays their share.",
      run: async (step) => {
        const d = await openGame(step);
        step("Filling the game");
        await post({ action: "fill" });
        step("90 minutes to go: reminder");
        await clockTo("soon");
        step("After the game: settling up");
        await clockTo("over");
        return `Played and settled. ${actAsHost(d)} to show the payout; each player's receipt is in their own private texts.`;
      },
    },
  ];

  async function runGameScenario(sc: GameScenario) {
    if (running) return;
    setNote(null);
    setRunning({ id: sc.id, step: "Starting" });
    try {
      const done = await sc.run((s) => setRunning({ id: sc.id, step: s }));
      setNote(done);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That didn't work");
    } finally {
      setRunning(null);
      load();
    }
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

  const isHost = viewer.id === organizerId;
  const hostName = people.get(organizerId)?.name ?? "the host";
  // The host can add anyone in the chat who isn't playing yet, including people you added with +.
  const addable = data.people.filter((p) => p.id !== organizerId && !data.game?.inIds.includes(p.id));
  const samples: Array<[string, Sample[]]> = isHost
    ? [
        ["Start a game", START],
        ["Run the game", [...addable.map((p) => ({ label: `Add ${p.name}`, text: `add ${p.name}` })), ...HOST]],
      ]
    : [["Say it like a person", PLAYER]];
  const allSamples = samples.flatMap(([, list]) => list);
  const picked = allSamples.find((sc) => sc.label === pick) ?? allSamples[0];
  const busy = sending || !!running;
  const simNow = new Date(realNow + (data.game?.clockOffsetMs ?? 0));
  const statusTime = phoneTime.format(simNow).replace(/\s?[AP]M$/, "");

  // Top bar: the game scenarios, then manual steps for the current game.
  const scenarios = (
    <section className="sim-panel" aria-labelledby="sim-game-h">
      <div className="sim-sec-head">
        <h2 id="sim-game-h" className="sim-label">
          Game scenarios{data.game ? (data.game.status === "draft" ? " · not posted yet" : ` · game ${data.game.when}`) : ""}
        </h2>

        {data.game && (
          <span className="sim-links">
            <a href={`/g/${data.game.slug}?p=${viewer.token}`} target="_blank" rel="noreferrer">Game page ↗</a>
            <a href={`/g/${data.game.slug}?o=${data.game.organizerToken}`} target="_blank" rel="noreferrer">Organizer ↗</a>
          </span>
        )}
      </div>
      <ul className="sim-cards">
        {GAME_SCENARIOS.map((sc) => {
          const on = running?.id === sc.id;
          return (
            <li key={sc.id} className={on ? "sim-card on" : "sim-card"}>
              <h3>{sc.title}</h3>
              <p>{on ? <span className="sim-card-step" aria-live="polite">{running.step}…</span> : sc.body}</p>
              <button type="button" className="dr-btn" disabled={busy} onClick={() => runGameScenario(sc)} aria-label={`Run: ${sc.title}`}>
                {on ? "Running…" : "Run"}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="sim-manual">
        <span className="sim-label">Or step through it</span>
        {data.game ? (
          <>
            <div className="sim-scn-acts">
              <button type="button" className="dr-btn" disabled={busy} onClick={() => control({ action: "join", personId: viewerId }, () => `${viewer.name} is in with a simulated hold.`)}>
                Join as {viewer.name}
              </button>
              <button type="button" className="dr-btn" disabled={busy} onClick={() => control({ action: "fill" }, (r) => `Added ${r.added} players with simulated holds. One spot left.`)}>
                Fill, leave 1 spot
              </button>
            </div>
            <ol className="sim-track" aria-label="Move the clock">
              {CLOCK.map(([mode, label, what]) => (
                <li key={mode}>
                  <button type="button" aria-pressed={clock === mode} disabled={busy} onClick={() => moveTo(mode)}>
                    <span className="sim-dot" aria-hidden="true" />
                    <strong>{label}</strong>
                    <span>{what}</span>
                  </button>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="sim-hint">No game yet. Run a scenario, or send “Game with full details” as the host.</p>
        )}
      </div>
      <p className="sim-hint">
        Scenarios use the real assistant and simulated holds. Each clock stop also does what&apos;s due then. For real sandbox money, open the game page and pay with PayPal.
      </p>
    </section>
  );

  // Beside the phones: who you are, and a sample message to send as them.
  const peopleBlock = (
    <section className="sim-people" aria-labelledby="sim-people-h">
      <h2 id="sim-people-h" className="sim-label">People · tap to act as them</h2>
      <div className="sim-pills">
        {data.people.map((p) => (
          <button key={p.id} type="button" className="sim-pill" aria-pressed={p.id === viewerId} onClick={() => setViewerId(p.id)}>
            {p.name}
            {p.id === organizerId && <small> · host</small>}
          </button>
        ))}
        {adding ? (
          <form
            className="sim-pill-add"
            onSubmit={async (e) => {
              e.preventDefault();
              const name = newName.trim();
              if (!name) return;
              const r = await control({ action: "addPerson", name }, () => `${name} joined the chat. They weren't here when the game was made.`);
              if (r.personId) {
                setViewerId(r.personId as string);
                setAdding(false);
              }
            }}
          >
            <label className="sr-only" htmlFor="sim-new">Name</label>
            <input id="sim-new" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={20} autoFocus />
            <button className="sim-pill-ok">Add</button>
            <button type="button" className="sim-pill-x" aria-label="Cancel" onClick={() => setAdding(false)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </form>
        ) : (
          <button type="button" className="sim-pill sim-plus" aria-label="Add someone to the chat" onClick={() => setAdding(true)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </button>
        )}
      </div>

      <form
        className="sim-say"
        onSubmit={(e) => {
          e.preventDefault();
          runSample(picked);
        }}
      >
        <label className="sim-label" htmlFor="sim-say">Send a sample message</label>
        <select id="sim-say" className="sim-select" value={picked.label} onChange={(e) => setPick(e.target.value)}>
          {samples.map(([title, list]) => (
            <optgroup key={title} label={title}>
              {list.map((sc) => (
                <option key={sc.label} value={sc.label}>
                  {sc.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <p className="sim-quote">
          <span>{viewer.name}:</span> “{picked.text}”
        </p>
        <p className="sim-hint">
          {isHost ? `${viewer.name} is the host, so these are host messages.` : `Host messages, like adding someone, are under ${hostName}. Tap their pill.`}
        </p>
        <button className="dr-btn p" disabled={busy}>
          {sending ? "Sending…" : `Send as ${viewer.name}`}
        </button>
      </form>
    </section>
  );

  return (
    <SimShell
      controls={scenarios}
      actions={
        <button type="button" className="sp-link" onClick={newGroup}>
          New<span className="sp-wide"> demo</span> group
        </button>
      }
    >
      <p className="sim-note" role="status">
        {note}
      </p>
      <div className="sim-grid">
        <div className="sim-side">
          <section className="sim-clock" aria-labelledby="sim-clock-h" aria-live="polite">
            <h2 id="sim-clock-h" className="sim-label">Simulated time</h2>
            <p className="sim-clock-time">{dayTime.format(simNow).replace(/ (AM|PM)$/, (m) => m.toLowerCase().trim())}</p>
            <p className="sim-hint">{data.game ? `Game ${data.game.when} · move it with the clock above` : "Real time. Start a game to move the clock."}</p>
          </section>
          {peopleBlock}
        </div>
        <section className="phone lp-phone" aria-label={`Group chat: ${data.group.name}`}>
          <div className="lp-screen light sim-screen">
            <StatusBar time={statusTime} />
            <div className="phone-top">
              <span className="phone-title">{data.group.name}</span>
              <span className="phone-sub">{data.people.length} people + Assistant</span>
            </div>
            <div className="phone-body" role="log" aria-label="Group messages" ref={groupBody}>
              {groupMsgs.map((m) => bubble(m))}
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
          </div>
        </section>

        <section className="phone lp-phone" aria-label={`${viewer.name}'s private texts with the Assistant`}>
          <div className="lp-screen light sim-screen">
            <StatusBar time={statusTime} />
            <div className="phone-top">
              <span className="phone-title">Assistant</span>
              <span className="phone-sub">{viewer.name}&apos;s private texts · money details only arrive here</span>
            </div>
            <div className="phone-body" role="log" aria-label="Private messages" ref={dmBody}>
              {inbox.length ? inbox.map((m) => bubble(m, true)) : <p className="phone-empty">No private texts yet.</p>}
            </div>
          </div>
        </section>
      </div>
    </SimShell>
  );
}
