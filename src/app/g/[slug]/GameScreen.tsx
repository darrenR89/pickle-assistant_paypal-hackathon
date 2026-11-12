"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Icon from "@/app/Icon";
import Logo from "@/app/Logo";
import type { ViewData } from "./page";
import GameRecap from "./GameRecap";

// ---------- PayPal JS SDK (only the parts we use) ----------
type PayPalButtons = { isEligible(): boolean; render(el: HTMLElement): Promise<void>; close?: () => Promise<void> };
type PayPalNamespace = {
  Buttons(opts: {
    fundingSource?: string;
    style?: Record<string, unknown>;
    onClick?: (data: unknown, actions: { reject(): void; resolve(): void }) => void;
    createOrder?: () => Promise<string>;
    /** Save the payment method for a later hold instead of holding now. */
    createVaultSetupToken?: () => Promise<string>;
    onApprove: (data: { orderID?: string; vaultSetupToken?: string }) => Promise<void>;
    onCancel?: () => void;
    onError: (err: unknown) => void;
  }): PayPalButtons;
  FUNDING: { PAYPAL: string; VENMO: string };
};
declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}
function loadSdk(clientId: string, save?: { token: string | null }): Promise<PayPalNamespace> {
  if (window.paypal) return Promise.resolve(window.paypal);
  return new Promise((resolve, reject) => {
    // Saving a payment method for later uses the same buttons without an order intent, and PayPal only.
    const params = new URLSearchParams(
      save
        ? { "client-id": clientId, components: "buttons" }
        : { "client-id": clientId, currency: "USD", intent: "authorize", components: "buttons", "enable-funding": "venmo" },
    );
    const script = document.createElement("script");
    script.src = `https://www.paypal.com/sdk/js?${params}`;
    if (save?.token) script.setAttribute("data-user-id-token", save.token);
    script.onload = () => (window.paypal ? resolve(window.paypal) : reject(new Error("PayPal didn't load")));
    script.onerror = () => reject(new Error("Couldn't load PayPal"));
    document.head.appendChild(script);
  });
}

const money = (c: number) => `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`;
type Sheet = null | "who" | "join" | "placing" | "success" | "manage" | "cancel" | "explain" | "error" | "edit" | "more" | "settle" | "calloff" | "refund" | "payoutTo";
type ErrKind = "closed" | "declined" | "full" | "invite" | "other";

const OFFLINE = "Couldn’t reach the server. Check your connection and try again.";

export default function GameScreen({ view: v, demo = null }: { view: ViewData; demo?: string | null }) {
  const router = useRouter();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [err, setErr] = useState<{ kind: ErrKind; text?: string } | null>(null);
  const [partnersOpen, setPartnersOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [refundFor, setRefundFor] = useState<{ id: string; name: string; cents: number } | null>(null);
  const [fund, setFund] = useState<"paypal" | "venmo">("paypal");
  // Joined a far-off game: PayPal is saved and the hold comes later.
  const [savedLater, setSavedLater] = useState(false);
  const saved = savedLater || v.myHold === "saved";
  // On a computer the bottom bar becomes the right-hand column.
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const on = () => setWide(mq.matches && !demo);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [demo]);
  const org = v.organizer;
  const [asked, setAsked] = useState(v.asked);
  // Every action below goes through this, so a request that never gets an answer (no signal, the
  // server waking up) unlocks the buttons and says so instead of leaving them disabled until a reload.
  async function post(path: string, body: Record<string, unknown>) {
    try {
      const res = await fetch(`/api/games/${v.slug}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as { error?: string; nudged?: number };
      return { ok: res.ok, data };
    } catch {
      return { ok: false, data: { error: OFFLINE } as { error?: string; nudged?: number } };
    }
  }

  async function askToJoin() {
    const res = await post("request", { p: v.p });
    if (res.ok) {
      setAsked(true);
      setToast(`Asked ${v.hostName} privately.`);
    } else setToast(res.data.error ?? "Couldn’t send that");
  }

  const draft = v.status === "draft";
  const needs = org?.needs ?? [];
  const NEED: Record<string, string> = { when: "the time", place: "where you’re playing", price: "the court cost" };
  const needWords = listWords(needs.map((n) => NEED[n] ?? n));
  const count = v.players.length;
  const left = Math.max(0, v.spots - count);
  const iAmIn = v.me === "in" || v.me === "paid";
  const open = v.status === "open" && !v.over;
  const sharesLate = org ? org.players.filter((p) => p.late).map((p) => p.name) : v.me === "late" ? [v.viewerName ?? "You"] : [];

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const close = (e: KeyboardEvent) => e.key === "Escape" && sheet !== "placing" && setSheet(null);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [sheet]);

  async function organizerAct(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setFormErr(null);
    const res = await post("organizer", { o: v.o, action, ...extra });
    const body = res.data;
    setBusy(false);
    if (!res.ok) {
      setFormErr(body.error ?? "Something went wrong");
      return false;
    }
    if (action === "nudge") setToast(body.nudged ? `Reminded ${body.nudged} in the group.` : "Nobody’s waiting to confirm.");
    router.refresh();
    return true;
  }

  async function dropOut() {
    setBusy(true);
    const res = await post("out", { p: v.p });
    setBusy(false);
    setSheet(null);
    if (!res.ok) setToast(res.data.error ?? "Couldn’t drop out");
    else setToast(v.beforeCancelBy ? "You’re out. Your hold was released." : `You’re out. ${v.hostName} will decide on your share.`);
    router.refresh();
  }

  function calendarUrl() {
    const f = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const params = new URLSearchParams({ action: "TEMPLATE", text: `Pickleball${v.kindLabel ? ` · ${v.kindLabel}` : ""}`, dates: `${f(v.calendar.startIso)}/${f(v.calendar.endIso)}`, location: v.calendar.where });
    return `https://calendar.google.com/calendar/render?${params}`;
  }

  // ---------- pieces ----------
  const flag = v.status === "cancelled" ? "Called off" : v.status === "settled" ? "Played · settled" : v.over ? "Game over · settling up" : null;

  const header = (
    <header className="hdr">
      <Logo className="hdr-logo" />
      <div className="eyebrow">
        <span className="d">{v.dateLabel}</span>
        {v.kindLabel && (
          <>
            <span className="div" aria-hidden="true" />
            <span className="t">{v.kindLabel}</span>
          </>
        )}
      </div>
      {draft && needs.includes("when") ? (
        <h1 className="timerow" aria-label="Time not set yet" style={{ margin: 0 }}>
          <span className="time" style={{ fontSize: "clamp(64px, 18vw, 120px)", opacity: 0.55, padding: "18px 0 6px" }}>Time?</span>
        </h1>
      ) : (
        <h1 className="timerow" aria-label={`${v.clock} ${v.meridiem}`} style={{ margin: 0 }}>
          <span className={`time${v.clock.length > 4 ? " long" : ""}`}>{v.clock}</span>
          <span className="pm">{v.meridiem}</span>
        </h1>
      )}
      {v.facts && <span className="facts">{v.facts}</span>}
      {flag && <span className="flag">{flag}</span>}
    </header>
  );

  const doubles = v.doubles;
  const fixed = doubles && v.partners === "fixed";
  const ptTitle = !doubles ? "Rotating opponents" : fixed ? "Fixed partners" : "Rotating partners";
  const ptBody = !doubles
    ? "You’ll play a different opponent each round."
    : fixed
      ? "You play every round with the same partner. Come as a pair, or we’ll pair you up."
      : "You’ll play with a new partner each round, so you play with everyone.";
  const segs = Array.from({ length: v.spots }, (_, i) => (
    <span key={i} className={i < count ? "on" : i < count + sharesLate.length ? "late" : ""} />
  ));
  const playersTitle = v.status === "cancelled" ? `${count} were in` : v.status === "draft" ? `${v.spots} spots` : v.status !== "open" || v.over ? `${count} played` : left === 0 ? "Game’s full" : `${left} spot${left === 1 ? "" : "s"} left`;

  const playersCard = (
    <section className="card half tall" aria-label="Players">
      <div style={{ padding: "18px 2px 20px" }}>
        <div className="line">
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Icon name="person" />
            <h2 className="ttl" style={{ margin: 0 }}>{playersTitle}</h2>
          </div>
          <button className="lnk" onClick={() => setSheet("who")}>
            See who’s in
          </button>
        </div>
        <div className="segs" aria-label={`${count} of ${v.spots} spots filled`}>{segs}</div>
        {sharesLate.length > 0 && (
          <div style={{ marginTop: 10, font: "600 15px/1.3 var(--sans)", color: "var(--danger)" }}>
            {org ? `${sharesLate.join(", ")} cancelled late` : "You cancelled late"}
          </div>
        )}
        {v.inviteOnly && (
          <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", font: "500 15px/1.35 var(--sans)", color: "var(--muted)" }}>
            <Icon name="lock" size={18} /> Invite-only
            {v.invited.length ? `: ${v.invited.length > 5 ? `${v.invited.slice(0, 4).join(", ")} and ${v.invited.length - 4} more` : v.invited.join(", ")}` : ""}
          </div>
        )}
      </div>
      <button className="pt" aria-expanded={partnersOpen} onClick={() => setPartnersOpen((x) => !x)}>
        <span className="pt-row">
          <Icon name={fixed ? "pair" : "swap"} />
          <span className="pt-title">{ptTitle}</span>
          <span className="pt-chev">
            <Icon name="chev" size={22} stroke={2.4} />
          </span>
        </span>
        <span className="pt-body">
          <div>
            <p>{ptBody}</p>
          </div>
        </span>
      </button>
      <div className="host">
        <span className="av" aria-hidden="true">{v.hostName[0]}</span>
        <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ font: "500 15px/1 var(--sans)", color: "var(--muted)" }}>Hosted by</span>
          <span style={{ font: "700 19px/1.2 var(--sans)", color: "var(--ink)" }}>
            {v.hostName}
            {org ? " (you)" : ""}
          </span>
        </span>
      </div>
    </section>
  );

  const locationCard = (
    <section className="card half" aria-label="Where">
      <div className="row">
        <Icon name="pin" />
        <div className="tx">
          <div className="line">
            <span className="ttl">{v.courts ?? (v.place || "Where are you playing?")}</span>
            {v.place ? (
              <a className="lnk" href={v.mapsUrl} target="_blank" rel="noreferrer">
                Open in Maps <Icon name="ext" size={18} />
              </a>
            ) : (
              org && (
                <button className="lnk" style={{ background: "none", border: "none", padding: 0 }} onClick={() => { setFormErr(null); setSheet("edit"); }}>
                  Add
                </button>
              )
            )}
          </div>
          {v.courts && <span className="strong">{v.place}</span>}
          {v.address && <span className="sub">{v.address}</span>}
        </div>
      </div>
    </section>
  );

  // What the money card says. The organizer paid the court and holds nothing; a far-off game saves
  // PayPal first and holds later; a failed hold holds nothing. Never show "$0 on hold" beside a share.
  const [moneyTitle, moneySub] = org
    ? [`Each share is ${money(v.shareCents)}`, `Players hold ${money(v.holdCents)}: the share plus up to ${money(v.capCents)} if the game runs short.`]
    : iAmIn && v.viewerIsHost
      ? ["Nothing on hold for you", `You paid for the court. Each player pays ${money(v.shareCents)} after the game.`]
      : iAmIn && saved
        ? [`Hold on ${v.holdDateLabel}`, `Nothing held yet. We hold ${money(v.holdCents)} then and charge your ${money(v.shareCents)} share after the game.`]
        : iAmIn && v.myHold === "failed"
          ? ["Hold didn’t go through", `Nothing is held or charged. Approve again${v.fixByLabel ? ` by ${v.fixByLabel}` : ""} to keep your spot.`]
          : iAmIn
            ? [`${money(v.myHoldCents)} on hold`, `Your share is ${money(v.shareCents)}. Charged after the game, never before.`]
            : [`${money(v.shareCents)} is your share`, `We hold ${money(v.holdCents)} ${v.savesFirst ? `on ${v.holdDateLabel}` : "now"} and charge after the game`];

  const moneyCard = (
    <section className="card half" aria-label="Money">
      <button className="row" onClick={() => setSheet("explain")} style={{ width: "100%", background: "none", border: "none", textAlign: "left" }}>
        <Icon name="card" />
        <div className="tx">
          <span className="ttl">{moneyTitle}</span>
          <span className="sub">{moneySub}</span>
        </div>
      </button>
      <button className="row" onClick={() => setSheet("explain")} style={{ width: "100%", background: "none", border: "none", borderTop: "1px solid var(--line)", textAlign: "left" }}>
        <Icon name="undo" />
        <div className="tx">
          <span className="ttl">{v.beforeCancelBy ? `Free cancel until ${v.cancelByLabel}` : `Free cancel ended ${v.cancelByLabel}`}</span>
          <span className="sub">{v.viewerIsHost ? (v.beforeCancelBy ? "Players can drop out free until then" : "If a player drops out now, you decide whether they pay") : v.beforeCancelBy ? "Your hold is released in full" : `Cancelling now: ${v.hostName} decides whether your ${money(v.shareCents)} is charged`}</span>
        </div>
      </button>
    </section>
  );

  const notices: React.ReactNode[] = [];
  if (draft && !org)
    notices.push(<Notice key="dn" tone="lav" icon="alert" title="Not posted yet" body={`${v.hostName} is still setting this game up. You’ll get the link in the group when it’s ready.`} />);
  if (draft && org)
    notices.push(
      <Notice
        key="d"
        tone="lav"
        icon="alert"
        title="Not posted yet"
        body={`Add ${needWords} and I’ll post the game to the group. Nobody sees it until then.`}
        action={{ label: "Add details", onClick: () => { setFormErr(null); setSheet("edit"); } }}
      />,
    );
  if (v.status === "cancelled")
    notices.push(
      <Notice
        key="c"
        tone="lav"
        icon="alert"
        title={`${v.hostName} called off this game`}
        body={
          org?.closeChoice === "charged"
            ? "Free cancel had passed and the court fee was lost, so everyone holding a spot paid their share."
            : org
              ? "Every hold was released. Nobody was charged."
              : v.me === "charged"
                ? "Free cancel had passed and the court fee was lost."
                : "Any hold you had was released. Nobody was charged."
        }
      />,
    );
  if (v.me === "paid" && !org) {
    const extra = v.myChargedCents - v.shareCents;
    const rest = v.myHoldCents - v.myChargedCents;
    notices.push(
      <Notice
        key="p"
        icon="receipt"
        title={`You paid ${money(v.myChargedCents)}`}
        body={`${extra > 0 ? `Your ${money(v.shareCents)} share plus ${money(extra)} because the game ran short.` : `Your ${money(v.shareCents)} share.`} ${rest > 0 ? `The other ${money(rest)} of your hold was released.` : `That’s your full ${money(v.myHoldCents)} hold, the most a game can cost you.`}`}
      />,
    );
  }
  if (v.status === "open" && v.over && !org) notices.push(<Notice key="s" tone="lav" icon="receipt" title="Settling up tonight" body="About 3 hours after the start, everyone who played is charged their share." />);
  if (v.me === "late") notices.push(<Notice key="l" tone="red" icon="alert" title={`You’re out · waiting on ${v.hostName}`} body={`You cancelled after free cancel ended. ${v.hostName} will charge your ${money(v.shareCents)} share or cover it. Your hold stays until they decide.`} />);
  if (v.me === "charged")
    notices.push(
      <Notice
        key="ch"
        tone="red"
        icon="receipt"
        title={`Your ${money(v.myChargedCents)} share was charged`}
        body={
          v.status === "cancelled"
            ? `The game was called off after free cancel and the court fee couldn’t be refunded. The rest of your hold was released.`
            : `${v.hostName} charged the late cancel. The rest of your hold was released. If someone takes your spot, ${v.hostName} can refund it.`
        }
      />,
    );
  if (v.me === "refunded") notices.push(<Notice key="rf" icon="check" title={`Refunded ${money(v.myRefundedCents)}`} body={`${v.hostName} refunded your charge. It goes back to your PayPal or Venmo.`} />);
  if (v.me === "covered")
    notices.push(
      <Notice
        key="co"
        icon="check"
        title={`${v.hostName} covered your spot`}
        body={`Your hold was released in full. You weren’t charged.${v.status === "open" && left > 0 ? " Made it after all? Tap below to pay your share like everyone else." : ""}`}
        action={v.status === "open" && left > 0 ? { label: "I showed up", onClick: () => { setErr(null); setFormErr(null); setSheet("join"); } } : undefined}
      />,
    );
  if (v.myHold === "saved" && v.status === "open" && !org)
    notices.push(<Notice key="sv" icon="check" title="You’re in. No hold yet" body={`Your PayPal is saved. We’ll place your ${money(v.holdCents)} hold on ${v.holdDateLabel} and tell you when we do. Drop out before then and your saved PayPal is removed.`} />);
  if (v.myHold === "failed" && v.status === "open")
    notices.push(
      <Notice
        key="hf"
        tone="red"
        icon="alert"
        title="Your hold didn’t go through"
        body={`PayPal turned down the ${money(v.holdCents)} hold. Approve it again${v.fixByLabel ? ` by ${v.fixByLabel}` : ""} to keep your spot. Nothing was charged.`}
        action={{ label: "Approve again", onClick: () => setSheet("join") }}
      />,
    );
  if (v.me === "out" && v.status === "open") notices.push(<Notice key="o" icon="check" title="You’re out" body="Your hold was released. Changed your mind? Tap I’m in again while there’s space." />);
  if (v.inviteOnly && !v.canJoin && !org && v.p)
    notices.push(
      <Notice
        key="i"
        tone="lav"
        icon="lock"
        title="This game is invite-only"
        body={asked ? `We asked ${v.hostName} privately. You’ll get your link in the group if they add you.` : `${v.hostName} chose who’s playing. You can ask to join; only ${v.hostName} sees the request.`}
        action={asked ? undefined : { label: `Ask ${v.hostName}`, onClick: askToJoin }}
      />,
    );

  // ---------- bottom bar ----------
  let bar: React.ReactNode = null;
  if (org && draft) {
    // The notice at the top carries the one action.
  } else if (org && v.status === "open") {
    bar = (
      <nav className="bar" aria-label="Organizer actions" style={{ padding: "12px 12px calc(18px + env(safe-area-inset-bottom))" }}>
        <div className="orgbar" style={{ padding: 0, width: "100%" }}>
          <button onClick={() => { setFormErr(null); setSheet("edit"); }}>Edit</button>
          <button disabled={busy} onClick={() => organizerAct("nudge")}>Nudge</button>
          <button
            onClick={async () => {
              await navigator.clipboard?.writeText(`${window.location.origin}/g/${v.slug}`).catch(() => {});
              setToast("Game link copied. Paste it anywhere.");
            }}
          >
            Share
          </button>
          <button className="p" onClick={() => setSheet("more")}>More</button>
        </div>
      </nav>
    );
  } else if (!org && open && !v.viewerIsHost) {
    if (iAmIn)
      bar = (
        <div className="bar">
          <div className="info">
            <span className="price">You’re in</span>
            <span className="note">{saved ? `Hold on ${v.holdDateLabel} · nothing held yet` : v.myHold === "failed" ? "Hold didn’t go through" : `${money(v.myHoldCents)} held · charged after the game`}</span>
          </div>
          <button className="cta ghost" onClick={() => setSheet("manage")}>Manage</button>
        </div>
      );
    else if (v.me !== "late" && left === 0)
      bar = (
        <div className="bar">
          <div className="info">
            <span className="price">Game’s full</span>
            <span className="note">Say “waitlist me” in the group</span>
          </div>
        </div>
      );
    else if (v.me !== "late" && v.canJoin)
      bar = (
        <div className="bar">
          <div className="info">
            <span className="price">
              {money(v.shareCents)} <span>· {left} spot{left === 1 ? "" : "s"} left</span>
            </span>
            <span className="note">{v.savesFirst ? `Held ${v.holdDateLabel}, charged after` : "Held now, charged after"}</span>
          </div>
          <button className="cta" onClick={() => { setErr(null); setFormErr(null); setSheet("join"); }}>I’m in</button>
        </div>
      );
  }

  return (
    <div className={demo ? "app has-demo" : "app"}>
      {demo && (
        <a className="demo-back" href={`/demo/${demo}/phone`}>
          ‹ Chat
        </a>
      )}
      {header}
      <main className="scroll">
        <div className="content">
        {notices}
        {org && !draft && (
          <OrganizerCard
            v={v}
            busy={busy}
            onLate={(spotId, decision) => organizerAct("late", { spotId, decision })}
            onInvite={async (personId, yes) => {
              if (await organizerAct(yes ? "invite" : "decline", { personId })) setToast(yes ? "Added. They got their link in the group." : "Okay. Nothing was posted.");
            }}
            onRefund={(p) => { setFormErr(null); setRefundFor(p); setSheet("refund"); }}
            onKeep={async (personId) => { if (await organizerAct("keep", { personId })) setToast("Kept the charge. They got a private note."); }}
            onRetryPayout={async () => { if (await organizerAct("payout")) setToast("Trying the payout again."); }}
            onEditPayout={() => { setFormErr(null); setSheet("payoutTo"); }}
          />
        )}
        {playersCard}
        {locationCard}
        {(!org || v.status === "open" || (draft && !needs.includes("price"))) && moneyCard}
        </div>
        {wide && bar && <aside className="rail">{bar}</aside>}
      </main>
      {!wide && bar}

      {sheet && (
        <div className="scrim" onClick={(e) => e.target === e.currentTarget && sheet !== "placing" && setSheet(null)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
            {sheet === "who" && <WhoSheet v={v} close={() => setSheet(null)} />}
            {sheet === "join" && (
              <JoinSheet
                v={v}
                close={() => setSheet(null)}
                onStart={(f) => setFund(f)}
                onPlacing={() => setSheet("placing")}
                onDone={(token, later) => {
                  setSavedLater(later);
                  const url = new URL(window.location.href);
                  url.searchParams.set("p", token);
                  router.replace(url.pathname + url.search);
                  router.refresh();
                  setSheet("success");
                }}
                onError={(kind, text) => {
                  setErr({ kind, text });
                  setSheet("error");
                }}
              />
            )}
            {sheet === "placing" && (
              <>
                <span className="grab" />
                <div className="spin" aria-hidden="true" />
                <h2 id="sheet-title" className="center" style={{ margin: 0, font: "800 30px/1 var(--cond)", textTransform: "uppercase" }}>Placing your hold</h2>
                <p className="sh-p center" role="status">Don’t close this. It takes a second or two.</p>
              </>
            )}
            {sheet === "success" && (
              <>
                <span className="grab" />
                <div className="big-ok"><Icon name="check" size={38} stroke={3} /></div>
                <h2 id="sheet-title" className="center" style={{ margin: 0, font: "800 34px/1 var(--cond)", textTransform: "uppercase" }}>You’re in</h2>
                <p className="sh-p center">
                  {saved
                    ? `Your PayPal is saved and nothing is held yet. We’ll place the ${money(v.holdCents)} hold on ${v.holdDateLabel} and tell you when we do. Your share is ${money(v.shareCents)}, charged after the game.`
                    : `${money(v.holdCents)} is on hold with ${fund === "venmo" ? "Venmo" : "PayPal"}. Your share is ${money(v.shareCents)} and nothing is charged until after the game.`}
                </p>
                <div style={{ display: "grid", gap: 12, margin: "0 4px" }}>
                  <a className="cta wide" style={{ display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }} href={calendarUrl()} target="_blank" rel="noreferrer">Add to calendar</a>
                  <button className="cta ghost wide" onClick={() => setSheet(null)}>Done</button>
                </div>
              </>
            )}
            {sheet === "manage" && (
              <>
                <SheetHead title="Your spot" close={() => setSheet(null)} />
                <div className="card" style={{ margin: "0 4px" }}>
                  <div className="ledger">
                    <div><span>{saved ? `Hold placed ${v.holdDateLabel}` : v.myHold === "failed" ? "Hold (not placed)" : "On hold"}</span><span className="em">{money(v.myHoldCents)}</span></div>
                    <div><span>Your share</span><span>{money(v.shareCents)}</span></div>
                    <div><span>Charged now</span><span>$0</span></div>
                  </div>
                </div>
                <div style={{ display: "grid", gap: 12, margin: "0 4px" }}>
                  <a className="cta wide" style={{ display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }} href={calendarUrl()} target="_blank" rel="noreferrer">Add to calendar</a>
                  <button className="cta ghost wide" style={v.beforeCancelBy ? undefined : { color: "var(--danger)" }} onClick={() => setSheet("cancel")}>Can’t make it</button>
                </div>
                <p className="sh-p center" style={{ fontSize: 15 }}>
                  {saved ? `Free cancel until ${v.cancelByLabel}. Dropping out before the hold removes your saved PayPal.` : v.beforeCancelBy ? `Free cancel until ${v.cancelByLabel}. Dropping out releases your whole hold.` : `Free cancel ended ${v.cancelByLabel}. If you drop out, ${v.hostName} decides on your ${money(v.shareCents)}.`}
                </p>
              </>
            )}
            {sheet === "cancel" && (
              <>
                <SheetHead title={v.beforeCancelBy ? "Drop out?" : "Cancel late?"} />
                <p className="sh-p">
                  {saved || v.myHold === "failed"
                    ? `Nothing is held, so there’s nothing to release. ${saved ? "Your saved PayPal is removed and your" : "Your"} spot opens for someone else.`
                    : v.beforeCancelBy
                    ? `You can drop out free until ${v.cancelByLabel}. Your ${money(v.myHoldCents)} hold is released right away and your spot opens for someone else.`
                    : `Free cancel ended ${v.cancelByLabel}. If you drop out now, your spot opens up and ${v.hostName} decides whether to charge your ${money(v.shareCents)} share or cover it.`}
                </p>
                <div style={{ display: "grid", gap: 12, margin: "0 4px" }}>
                  <button className="cta wide" disabled={busy} style={v.beforeCancelBy ? undefined : { background: "var(--danger)", boxShadow: "0 5px 0 #6E1909" }} onClick={dropOut}>
                    {v.beforeCancelBy && !saved && v.myHold !== "failed" ? "Release my hold" : "Drop out"}
                  </button>
                  <button className="cta ghost wide" onClick={() => setSheet(null)}>Keep my spot</button>
                </div>
              </>
            )}
            {sheet === "explain" && (
              <>
                <SheetHead title="How the hold works" close={() => setSheet(null)} />
                <div className="steps" style={{ gap: 14 }}>
                  <div className="done"><i>1</i>
                    {v.savesFirst || saved
                      ? `This game is more than 3 days away, so tapping I’m in saves your PayPal instead of holding today. On ${v.holdDateLabel} we hold ${money(v.holdCents)}: your ${money(v.shareCents)} share plus up to ${money(v.capCents)} in case the game runs short. Your saved PayPal is removed once the hold is placed.`
                      : `Tapping I’m in holds ${money(v.holdCents)} with PayPal or Venmo: your ${money(v.shareCents)} share plus up to ${money(v.capCents)} in case the game runs short.`}
                  </div>
                  <div className="done"><i>2</i>Nothing is charged before the game. Free cancel until {v.cancelByLabel} releases the whole hold.</div>
                  <div className="done"><i>3</i>After the game we charge your share and release the rest. If spots stayed empty, each player pays up to {money(v.capCents)} more; the host covers anything beyond that.</div>
                  <div className="done"><i>4</i>Cancel late and the host decides: charge your share or cover it.</div>
                </div>
              </>
            )}
            {sheet === "error" && err && <ErrorSheet err={err} v={v} retry={() => { setErr(null); setSheet("join"); }} close={() => setSheet(null)} />}
            {sheet === "edit" && org && <EditSheet v={v} busy={busy} formErr={formErr} save={async (body) => { if (await organizerAct("terms", body)) { setSheet(null); setToast(draft ? "Posted to the group." : "Saved. The group got an update."); } }} close={() => setSheet(null)} />}
            {sheet === "more" && org && (
              <>
                <SheetHead title="More" close={() => setSheet(null)} />
                <div className="menu">
                  <button onClick={() => setSheet("settle")}>
                    <Icon name="receipt" />
                    <div>Settle up now<span>Charge everyone who played. Normally runs on its own 3 hours after the start.</span></div>
                  </button>
                  <button className="danger" onClick={() => setSheet("calloff")}>
                    <Icon name="alert" />
                    <div>Call off the game<span>Releases every hold and tells the group.</span></div>
                  </button>
                </div>
                <p className="sh-p" style={{ fontSize: 14 }}>Holds older than 3 days are renewed automatically, so games booked further out stay covered.</p>
              </>
            )}
            {sheet === "settle" && org && (
              <>
                <SheetHead title="Settle up" />
                {org.gapCents > 0 ? (
                  <p className="sh-p">
                    {count} played, so the shares come to {money(count * v.shareCents)} of the {money(org.totalCents)} court. Who covers the {money(org.gapCents)} gap?
                  </p>
                ) : (
                  <p className="sh-p">{count} played and the shares cover the court, so everyone pays their {money(v.shareCents)} share.</p>
                )}
                <p className="sh-p" style={{ fontSize: 15 }}>Then what’s collected goes to your {org.payout.to ?? "Venmo or PayPal"}.</p>
                {formErr && <p className="err" style={{ margin: "0 8px" }} role="alert">{formErr}</p>}
                <div style={{ display: "grid", gap: 12, margin: "0 4px" }}>
                  {org.gapCents > 0 ? (
                    <>
                      <button className="cta wide" disabled={busy} onClick={async () => { if (await organizerAct("settle", { gap: "split" })) { setSheet(null); setToast("Settled. Everyone got their receipt."); } }}>
                        Split it · {money(org.splitEachCents)} more each
                      </button>
                      <button className="cta ghost wide" disabled={busy} onClick={async () => { if (await organizerAct("settle", { gap: "cover" })) { setSheet(null); setToast(`Settled. You covered ${money(org.gapCents)}.`); } }}>
                        I’ll cover {money(org.gapCents)}
                      </button>
                    </>
                  ) : (
                    <button className="cta wide" disabled={busy} onClick={async () => { if (await organizerAct("settle")) { setSheet(null); setToast("Settled. Everyone got their receipt."); } }}>Charge players</button>
                  )}
                  <button className="lnk" style={{ justifySelf: "center", padding: 10 }} onClick={() => setSheet(null)}>Not yet</button>
                </div>
                {org.gapCents > 0 && org.splitEachCents * count < org.gapCents && (
                  <p className="sh-p" style={{ fontSize: 15 }}>Splitting stops at the {money(v.capCents)} cap players agreed to, so you’d still cover {money(org.gapCents - org.splitEachCents * count)}.</p>
                )}
              </>
            )}
            {sheet === "calloff" && org && (
              <>
                <SheetHead title="Call it off?" />
                {v.beforeCancelBy || count <= 1 ? (
                  <p className="sh-p">Every hold is released and nobody is charged. The group gets a message.</p>
                ) : (
                  <p className="sh-p">Free cancel has passed. If the court still charges you, you can charge everyone who’s in their {money(v.shareCents)} share. The group only hears that it’s off.</p>
                )}
                {formErr && <p className="err" style={{ margin: "0 8px" }} role="alert">{formErr}</p>}
                <div style={{ display: "grid", gap: 12, margin: "0 4px" }}>
                  <button className="cta wide" disabled={busy} style={{ background: "var(--danger)", boxShadow: "0 5px 0 #6E1909" }} onClick={async () => { if (await organizerAct("cancel")) { setSheet(null); setToast("Called off. Everyone’s hold is released."); } }}>
                    {v.beforeCancelBy || count <= 1 ? "Call off the game" : "Call off · release everyone"}
                  </button>
                  {!v.beforeCancelBy && count > 1 && (
                    <button className="cta ghost wide" disabled={busy} onClick={async () => { if (await organizerAct("cancel", { charge: true })) { setSheet(null); setToast(`Called off. Shares charged; you’ll be paid back.`); } }}>
                      Charge shares instead
                    </button>
                  )}
                  <button className="lnk" style={{ justifySelf: "center", padding: 10 }} onClick={() => setSheet(null)}>Keep it on</button>
                </div>
              </>
            )}
            {sheet === "refund" && org && refundFor && (
              <>
                <SheetHead title={`Refund ${refundFor.name}?`} />
                <p className="sh-p">{money(refundFor.cents)} goes back to {refundFor.name}’s PayPal or Venmo, and {refundFor.name} gets a private note. It comes out of what you’re paid back.</p>
                {formErr && <p className="err" style={{ margin: "0 8px" }} role="alert">{formErr}</p>}
                <div style={{ display: "grid", gap: 12, margin: "0 4px" }}>
                  <button className="cta wide" disabled={busy} onClick={async () => { if (await organizerAct("refund", { spotId: refundFor.id })) { setSheet(null); setToast(`Refunded ${refundFor.name} ${money(refundFor.cents)}.`); } }}>Refund {money(refundFor.cents)}</button>
                  <button className="lnk" style={{ justifySelf: "center", padding: 10 }} onClick={() => setSheet(null)}>Not now</button>
                </div>
              </>
            )}
            {sheet === "payoutTo" && org && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  if (await organizerAct("payoutTo", { payoutTo: String(f.get("payoutTo") ?? ""), wallet: String(f.get("wallet") ?? "VENMO") })) {
                    setSheet(null);
                    setToast("Saved. That’s where you’ll be paid back.");
                  }
                }}
              >
                <SheetHead title="Where should we pay you back?" close={() => setSheet(null)} />
                <div style={{ display: "grid", gap: 14, margin: "0 8px 16px" }}>
                  <label className="field">
                    Send it to
                    <select name="wallet" defaultValue={org.payout.wallet}>
                      <option value="VENMO">Venmo</option>
                      <option value="PAYPAL">PayPal</option>
                    </select>
                  </label>
                  <label className="field">
                    Phone, Venmo @handle or PayPal email
                    <input name="payoutTo" defaultValue={org.payout.raw} autoComplete="off" required />
                  </label>
                  {formErr && <p className="err" role="alert">{formErr}</p>}
                  <button className="cta wide" disabled={busy}>Save</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
      <GameRecap v={v} />
    </div>
  );
}

// ---------- small pieces ----------

function SheetHead({ title, close }: { title: string; close?: () => void }) {
  return (
    <>
      <span className="grab" />
      <div className="sh-head">
        <h2 id="sheet-title">{title}</h2>
        {close && <button className="x" onClick={close}>Done</button>}
      </div>
    </>
  );
}

function Notice({ icon, title, body, tone, action }: { icon: "alert" | "receipt" | "check" | "lock"; title: string; body: string; tone?: "lav" | "red"; action?: { label: string; onClick: () => void } }) {
  return (
    <div className={`notice${tone ? ` ${tone}` : ""}`} role={tone === "red" ? "alert" : undefined}>
      <Icon name={icon} color={tone === "red" ? "var(--danger)" : "currentColor"} />
      <div className="tx">
        <span className="ttl">{title}</span>
        <span className="sub">{body}</span>
        {action && (
          <button className="cta" style={{ marginTop: 8, alignSelf: "flex-start", fontSize: 20, height: 50 }} onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}

function WhoSheet({ v, close }: { v: ViewData; close: () => void }) {
  const per = v.doubles ? 4 : 2;
  const courts = Math.max(1, Math.ceil(v.spots / per));
  const pos = v.doubles ? [[40, 38], [40, 102], [130, 38], [130, 102]] : [[40, 70], [130, 70]];
  const left = Math.max(0, v.spots - v.players.length);
  return (
    <>
      <SheetHead title="Who’s in" close={close} />
      <div className="court" role="img" aria-label={`${v.players.length} of ${v.spots} spots filled across ${courts} court${courts === 1 ? "" : "s"}`}>
        {Array.from({ length: courts }, (_, c) => (
          <svg key={c} viewBox="0 0 170 156" aria-hidden="true">
            <rect x="2" y="6" width="166" height="128" rx="6" fill="none" stroke="#E2DAF2" strokeWidth="2" />
            <line x1="85" y1="2" x2="85" y2="138" stroke="#fff" strokeWidth="3" />
            <line x1="62" y1="6" x2="62" y2="134" stroke="#E2DAF2" strokeWidth="1.5" />
            <line x1="108" y1="6" x2="108" y2="134" stroke="#E2DAF2" strokeWidth="1.5" />
            {pos.map(([cx, cy], pi) => {
              const i = c * per + pi;
              if (i >= v.spots) return null;
              const p = v.players[i];
              return p ? (
                <g key={pi}>
                  <circle cx={cx} cy={cy} r="20" fill="#FFC9A8" />
                  <text x={cx} y={cy + 6} textAnchor="middle" fontFamily="Figtree, sans-serif" fontWeight="800" fontSize="17" fill="#171428">{p.name[0]}</text>
                </g>
              ) : (
                <circle key={pi} cx={cx} cy={cy} r="19" fill="none" stroke="#E2DAF2" strokeWidth="2" strokeDasharray="4 4" />
              );
            })}
          </svg>
        ))}
      </div>
      <p className="sh-p">
        {v.kindLabel ?? "Pickleball"}
        {v.doubles ? (v.partners === "fixed" ? ", fixed partners." : ", rotating partners. Partners change each round.") : ". Opponents change each round."}
      </p>
      <div className="people" style={{ margin: "0 8px" }}>
        {v.players.map((p, i) => (
          <div key={i} className="p">
            <span className="av sm" aria-hidden="true">{p.name[0]}</span>
            {p.name}
            {p.host ? " (host)" : ""}
            {p.me ? " (you)" : ""}
          </div>
        ))}
        {Array.from({ length: left }, (_, i) => (
          <div key={`o${i}`} className="p open">
            <span className="av sm open" aria-hidden="true" />
            Open spot
          </div>
        ))}
      </div>
      <p className="sh-p" style={{ fontSize: 15 }}>Only names show here. Money stays private.</p>
    </>
  );
}

function JoinSheet({
  v,
  close,
  onStart,
  onPlacing,
  onDone,
  onError,
}: {
  v: ViewData;
  close: () => void;
  onStart: (f: "paypal" | "venmo") => void;
  onPlacing: () => void;
  onDone: (token: string, later: boolean) => void;
  onError: (kind: ErrKind, text?: string) => void;
}) {
  const paypalRef = useRef<HTMLDivElement>(null);
  const venmoRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const textsRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(v.clientId ? null : "PayPal isn’t set up on this server yet.");
  const [venmoShown, setVenmoShown] = useState(true);
  const cb = useRef({ onStart, onPlacing, onDone, onError });
  // Keep the latest callbacks for the PayPal buttons, which are created once.
  useEffect(() => {
    cb.current = { onStart, onPlacing, onDone, onError };
  });

  useEffect(() => {
    if (!v.clientId) return;
    let cancelled = false;
    const rendered: PayPalButtons[] = [];
    let token = v.p ?? undefined;
    loadSdk(v.clientId, v.savesFirst ? { token: v.saveToken } : undefined)
      .then((paypal) => {
        if (cancelled) return;
        const make = (source: string, el: HTMLDivElement | null, f: "paypal" | "venmo") => {
          if (!el) return false;
          const b = paypal.Buttons({
            fundingSource: source,
            style: { shape: "pill", height: 55 },
            onClick: (_d, actions) => {
              if (!token && (!nameRef.current?.value.trim() || !phoneRef.current?.value.trim())) {
                setError("Add your name and phone number first.");
                return actions.reject();
              }
              setError(null);
              cb.current.onStart(f);
              return actions.resolve();
            },
            [v.savesFirst ? "createVaultSetupToken" : "createOrder"]: async () => {
              const res = await fetch("/api/paypal/orders", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ slug: v.slug, p: token, name: nameRef.current?.value, phone: phoneRef.current?.value, texts: textsRef.current?.checked ?? false }),
              });
              const body = await res.json();
              if (!res.ok) {
                const kind: ErrKind = res.status === 403 ? "invite" : res.status === 409 && /full/i.test(body.error ?? "") ? "full" : "other";
                cb.current.onError(kind, body.error);
                throw new Error(body.error ?? "Couldn't start the hold");
              }
              token = body.p;
              return body.id as string;
            },
            onApprove: async ({ orderID, vaultSetupToken }) => {
              cb.current.onPlacing();
              const later = !!vaultSetupToken;
              const res = await fetch(later ? `/api/paypal/vault/${vaultSetupToken}/confirm` : `/api/paypal/orders/${orderID}/authorize`, { method: "POST" });
              const body = await res.json().catch(() => ({}));
              if (!res.ok) {
                cb.current.onError(/declin|instrument/i.test(JSON.stringify(body)) ? "declined" : "other", body.error);
                return;
              }
              cb.current.onDone(token!, later);
            },
            onCancel: () => cb.current.onError("closed"),
            onError: (e) => setError(e instanceof Error ? e.message : "Payment error"),
          });
          if (!b.isEligible()) return false;
          rendered.push(b);
          b.render(el).catch(() => {});
          return true;
        };
        make(paypal.FUNDING.PAYPAL, paypalRef.current, "paypal");
        // Saving for a later hold is PayPal only: Venmo saving isn't confirmed for this flow.
        if (!v.savesFirst && !make(paypal.FUNDING.VENMO, venmoRef.current, "venmo")) setVenmoShown(false);
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      cancelled = true;
      rendered.forEach((b) => b.close?.().catch(() => {}));
    };
  }, [v.clientId, v.p, v.slug, v.savesFirst, v.saveToken]);

  return (
    <>
      <SheetHead title={`I’m in · ${money(v.shareCents)}`} close={close} />
      <div className="card" style={{ margin: "0 4px" }}>
        <div className="ledger">
          <div><span>Your share</span><span>{money(v.shareCents)}</span></div>
          <div><span>If the game runs short</span><span>up to {money(v.capCents)}</span></div>
          {v.savesFirst ? (
            <>
              <div><b>Held on {v.holdDateLabel}</b><span className="em">{money(v.holdCents)}</span></div>
              <div><span>Held or charged today</span><span>$0</span></div>
            </>
          ) : (
            <>
              <div><b>Held today</b><span className="em">{money(v.holdCents)}</span></div>
              <div><span>Charged now</span><span>$0</span></div>
            </>
          )}
        </div>
      </div>
      {!v.p && (
        <div style={{ display: "grid", gap: 12, margin: "0 8px" }}>
          <label className="field">
            Your name
            <input ref={nameRef} autoComplete="given-name" placeholder="First name" />
          </label>
          <label className="field">
            Phone number
            <input ref={phoneRef} type="tel" autoComplete="tel" placeholder="(555) 555-0123" />
          </label>
          <span style={{ font: "400 14px/1.4 var(--sans)", color: "var(--muted)" }}>So the assistant knows who you are in the group. Never shared with anyone.</span>
        </div>
      )}
      <label className="optin">
        <input ref={textsRef} type="checkbox" />
        <span>
          <b>Text me updates privately</b>
          Your receipt, reminders and refunds by text. Leave it off and they’ll be on this page instead.
        </span>
      </label>
      {error && <p className="err" style={{ margin: "0 8px" }} role="alert">{error}</p>}
      <div style={{ display: "grid", gap: 10, margin: "0 4px" }}>
        <div ref={paypalRef} />
        <div ref={venmoRef} />
        {!venmoShown && !v.savesFirst && <p className="sh-p" style={{ fontSize: 14, margin: 0 }}>Venmo isn’t offered on this device.</p>}
      </div>
      {v.savesFirst && (
        <p className="sh-p" style={{ fontSize: 15 }}>
          This game is more than 3 days away, so approving saves your PayPal with Paddles In instead of holding money today. We use it once, to place your {money(v.holdCents)} hold on {v.holdDateLabel}, and tell you when we do. Then it’s removed, or sooner if you drop out. PayPal only for now.
        </p>
      )}
      <p className="sh-p" style={{ fontSize: 15 }}>
        {v.savesFirst ? "Approving is how you say you’re in. Nothing is charged until after the game." : "Approving the hold is how you say you’re in. Held, not charged, until after the game."}{" "}
        {v.beforeCancelBy ? `Free cancel until ${v.cancelByLabel}.` : `Free cancel has ended, so if you drop out ${v.hostName} decides on your ${money(v.shareCents)}.`}
      </p>
    </>
  );
}

function ErrorSheet({ err, v, retry, close }: { err: { kind: ErrKind; text?: string }; v: ViewData; retry: () => void; close: () => void }) {
  const copy: Record<ErrKind, [string, string, string | null]> = {
    closed: ["No hold placed", "You closed the checkout before approving. Nothing was held and you’re not in yet.", "Try again"],
    declined: ["Hold declined", "Your bank or card declined the hold. Nothing was charged. Try another card in PayPal, or use Venmo.", "Try again"],
    full: ["Someone beat you to it", "The last spot was taken while you were checking out. Nothing was held. Say “waitlist me” in the group and you’ll be tagged if a spot opens.", null],
    invite: ["Invite-only game", `${v.hostName} chose who’s playing. Say “I’m in” in the group and we’ll ask ${v.hostName} privately.`, null],
    other: ["Something went wrong", err.text ?? "Nothing was charged. Please try again.", "Try again"],
  };
  const [title, body, action] = copy[err.kind];
  return (
    <>
      <SheetHead title={title} />
      <div className="notice red" style={{ margin: "0 4px" }}>
        <Icon name="alert" color="var(--danger)" />
        <div className="tx">
          <span className="sub" style={{ color: "var(--ink)" }}>{body}</span>
        </div>
      </div>
      <div style={{ display: "grid", gap: 12, margin: "0 4px" }}>
        {action && <button className="cta wide" onClick={retry}>{action}</button>}
        <button className="cta ghost wide" onClick={close}>{action ? "Not now" : "OK"}</button>
      </div>
    </>
  );
}

type RefundTarget = { id: string; name: string; cents: number };

function OrganizerCard({
  v,
  onLate,
  onInvite,
  onRefund,
  onKeep,
  onRetryPayout,
  onEditPayout,
  busy,
}: {
  v: ViewData;
  onLate: (spotId: string, d: "charge" | "cover" | "wait") => void;
  onInvite: (personId: string, yes: boolean) => void;
  onRefund: (p: RefundTarget) => void;
  onKeep: (personId: string) => void;
  onRetryPayout: () => void;
  onEditPayout: () => void;
  busy: boolean;
}) {
  const org = v.organizer!;
  const settled = v.status === "settled";
  const closed = settled || v.status === "cancelled";
  const owed = (p: (typeof org.players)[number]) => p.holdStatus === "captured" ? p.capturedCents - p.refundedCents : 0;
  const po = org.payout;
  const to = po.to ?? "Venmo or PayPal";
  const payoutLine: Record<string, string> = {
    sending: `Sending to your ${to}`,
    pending: `On its way to your ${to}`,
    sent: `Sent to your ${to}`,
    unclaimed: `Waiting for you to claim it in ${to}`,
    failed: `Didn’t go through${po.error ? `: ${po.error}` : ""}`,
    none: "Nothing was collected, so there’s nothing to send",
  };
  return (
    <>
      {org.players
        .filter((p) => p.refundAsked && owed(p) > 0)
        .map((p) => (
          <div key={`r${p.id}`} className="notice lav" style={{ flexDirection: "column" }}>
            <div style={{ display: "flex", gap: 14 }}>
              <Icon name="receipt" />
              <div className="tx">
                <span className="ttl">{p.name}’s spot was filled</span>
                <span className="sub">You charged {p.name}’s late cancel, and someone has taken the spot. Refund their {money(owed(p))} through PayPal, or keep the charge. Only {p.name} hears what you decide.</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="cta" style={{ flex: 1, fontSize: 20 }} disabled={busy} onClick={() => onRefund({ id: p.id, name: p.name, cents: owed(p) })}>Refund {money(owed(p))}</button>
              <button className="cta ghost" style={{ flex: 1, fontSize: 20 }} disabled={busy} onClick={() => onKeep(p.personId)}>Keep it</button>
            </div>
          </div>
        ))}
      {org.waiting
        .filter((w) => w.kind === "request")
        .map((w) => (
          <div key={w.id} className="notice lav" style={{ flexDirection: "column" }}>
            <div style={{ display: "flex", gap: 14 }}>
              <Icon name="lock" />
              <div className="tx">
                <span className="ttl">{w.name} wants to join</span>
                <span className="sub">It’s invite-only. Add them and the group sees they’re invited; say not now and nothing is posted.</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="cta" style={{ flex: 1, fontSize: 20 }} disabled={busy} onClick={() => onInvite(w.id, true)}>Add {w.name}</button>
              <button className="cta ghost" style={{ flex: 1, fontSize: 20 }} disabled={busy} onClick={() => onInvite(w.id, false)}>Not now</button>
            </div>
          </div>
        ))}
      {org.players
        .filter((p) => p.late)
        .map((p) => (
          <div key={p.id} className="notice red" style={{ flexDirection: "column" }}>
            <div style={{ display: "flex", gap: 14 }}>
              <Icon name="alert" color="var(--danger)" />
              <div className="tx">
                <span className="ttl">{p.lateWait ? `Waiting for someone to take ${p.name}’s spot` : `${p.name} cancelled after free cancel`}</span>
                <span className="sub">
                  {p.lateWait
                    ? `If someone takes it, ${p.name} owes nothing and their hold is released. If nobody does, their ${money(v.shareCents)} share is charged after the game.`
                    : `Choose how you want to handle their ${money(v.shareCents)} share.`}
                </span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="cta" style={{ flex: 1, fontSize: 20 }} disabled={busy} onClick={() => onLate(p.id, "charge")}>Charge {money(v.shareCents)}</button>
              <button className="cta ghost" style={{ flex: 1, fontSize: 20 }} disabled={busy} onClick={() => onLate(p.id, "cover")}>Cover it</button>
              {!p.lateWait && (
                <button className="cta ghost" style={{ flex: "1 1 100%", fontSize: 20 }} disabled={busy} onClick={() => onLate(p.id, "wait")}>Wait for a replacement</button>
              )}
            </div>
          </div>
        ))}
      <section className="card" aria-label="Your game">
        <div className="stats">
          <div className="stat">
            <span className="k">Shares in</span>
            <span className="v">{money(org.sharesInCents)} <small>of {money(org.totalCents)}</small></span>
          </div>
          <div className="stat">
            <span className="k">{settled ? "Collected" : "On hold now"}</span>
            <span className="v">{money(settled ? org.collectedCents : v.status === "cancelled" ? 0 : org.heldCents)}</span>
          </div>
        </div>
        <div style={{ padding: "0 2px 6px" }}>
          <div className="line">
            <span className="ttl">Players</span>
            <span style={{ font: "600 14px/1 var(--sans)", color: "var(--muted)" }}>Only you see money</span>
          </div>
        </div>
        <div className="olist">
          {org.players.map((p) => (
            <div key={p.id} className="o">
              <span className={`av sm${p.late ? " open" : ""}`} aria-hidden="true">{p.late ? "" : p.name[0]}</span>
              <span className="nm">{p.isHost ? `${p.name} (you)` : p.name}</span>
              <span className="st" style={p.late ? { color: "var(--danger)" } : undefined}>
                {p.isHost
                  ? "Paid the court"
                  : p.late
                    ? `Late cancel · ${money(p.holdCents)} held`
                    : p.holdStatus === "captured" && p.refundedCents >= p.capturedCents
                      ? `Refunded ${money(p.refundedCents)}`
                      : p.holdStatus === "captured"
                        ? `${p.lateCharged ? "Late cancel · paid" : "Paid"} ${money(p.capturedCents - p.refundedCents)}`
                      : p.holdStatus === "held"
                        ? `${money(p.holdCents)} held`
                        : p.holdStatus === "saved"
                          ? `Hold on ${v.holdDateLabel}`
                          : p.holdStatus === "failed"
                            ? "Hold didn’t go through"
                        : p.holdStatus === "voided"
                          ? "Hold released"
                          : "—"}
              </span>
              {!p.isHost && p.lateCharged && owed(p) > 0 && (
                <button className="lnk" style={{ marginLeft: 4, fontSize: 15 }} disabled={busy} onClick={() => onRefund({ id: p.id, name: p.name, cents: owed(p) })}>
                  Refund
                </button>
              )}
            </div>
          ))}
          {org.waiting
            .filter((w) => w.kind !== "request")
            .map((w) => (
              <div key={w.name} className="o">
                <span className="av sm open" aria-hidden="true" />
                <span className="nm" style={{ color: "var(--muted)", fontWeight: 500 }}>{w.name}</span>
                <span className="st">{w.kind === "waitlist" ? "Waitlist" : w.kind === "maybe" ? "Maybe" : "Said in, not confirmed"}</span>
              </div>
            ))}
        </div>
      </section>
      <section className="card" aria-label="Paying you back" style={{ padding: "14px 16px" }}>
        <div className="line">
          <span className="ttl">{closed && po.status ? `Payout · ${money(po.cents)}` : "Paying you back"}</span>
          {po.status !== "sent" && po.status !== "pending" && po.status !== "sending" && (
            <button className="lnk" onClick={onEditPayout}>Change</button>
          )}
        </div>
        <p className="sub" style={{ margin: "6px 2px 4px", font: "500 16px/1.45 var(--sans)", color: "var(--muted)" }}>
          {closed && po.status
            ? (payoutLine[po.status] ?? po.status)
            : `After the game, what players paid goes to your ${po.to ?? "Venmo or PayPal (add where)"}.`}
        </p>
        {po.status === "failed" && (
          <button className="cta" style={{ marginTop: 8, fontSize: 20, height: 50 }} disabled={busy} onClick={onRetryPayout}>Retry payout</button>
        )}
      </section>
    </>
  );
}

function EditSheet({ v, busy, formErr, save, close }: { v: ViewData; busy: boolean; formErr: string | null; save: (b: Record<string, unknown>) => void; close: () => void }) {
  const org = v.organizer!;
  const draft = v.status === "draft";
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const g = (k: string) => String(f.get(k) ?? "");
        save({
          startsAt: g("date") && g("time") ? `${g("date")}T${g("time")}` : undefined,
          place: g("place"),
          courts: g("courts"),
          address: g("address"),
          kind: g("kind") || undefined,
          partners: g("partners") || undefined,
          level: g("level"),
          setting: g("setting") || undefined,
          cancelBy: g("cancelBy") || undefined,
          spots: Number(g("spots")),
          totalCents: Math.round(Number(g("total")) * 100),
          capCents: Math.round(Number(g("cap")) * 100),
        });
      }}
      style={{ display: "contents" }}
    >
      <SheetHead title={draft ? "Finish the game" : "Edit the game"} close={close} />
      <p className="sh-p">
        {draft
          ? "I filled in what I could from the chat. Check it, add what’s missing, and I’ll post it to the group."
          : "Once someone is in, money changes can only help players. Where and what kind of game can change any time."}
      </p>
      <div style={{ display: "grid", gap: 12, margin: "0 8px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label className="field">Day<input name="date" type="date" defaultValue={org.startDate} required /></label>
          <label className="field">Start time<input name="time" type="time" step={1800} defaultValue={draft && org.needs.includes("when") ? "" : org.startTime} required autoFocus={draft && org.needs.includes("when")} /></label>
        </div>
        <label className="field">Place name<input name="place" defaultValue={v.place} required /></label>
        <label className="field">Courts (optional)<input name="courts" defaultValue={v.courts ?? ""} placeholder="e.g. Courts 3–4" /></label>
        <label className="field">Street address<input name="address" defaultValue={v.address ?? ""} autoComplete="street-address" /></label>
        <label className="field">
          Game type
          <select name="kind" defaultValue={org.kind ?? ""}>
            <option value="">Not set</option>
            <option value="mixed">Mixed doubles</option>
            <option value="womens">Women’s doubles</option>
            <option value="mens">Men’s doubles</option>
            <option value="any">Any doubles</option>
            <option value="singles">Singles</option>
          </select>
        </label>
        <label className="field">
          Partners (doubles)
          <select name="partners" defaultValue={v.partners ?? "rotating"}>
            <option value="rotating">Rotating each round</option>
            <option value="fixed">Fixed partners</option>
          </select>
        </label>
        <label className="field">Level (optional)<input name="level" defaultValue={org.level} placeholder="e.g. 3.0–3.5" /></label>
        <label className="field">
          Indoor or outdoor
          <select name="setting" defaultValue={org.setting ?? ""}>
            <option value="">Not set</option>
            <option value="outdoor">Outdoor</option>
            <option value="indoor">Indoor</option>
          </select>
        </label>
        {!draft && <label className="field">Free cancel until<input name="cancelBy" type="datetime-local" defaultValue={org.cancelByLocal} /></label>}
        <label className="field">Spots<input name="spots" type="number" min={2} max={32} defaultValue={v.spots} /></label>
        <label className="field">Court cost, total ($)<input name="total" type="number" min={draft ? 1 : 0} step="0.01" defaultValue={org.totalCents ? org.totalCents / 100 : ""} required={draft} /></label>
        <label className="field">Short-game extra, up to ($)<input name="cap" type="number" min={0} step="0.01" defaultValue={v.capCents / 100} /></label>
      </div>
      {formErr && <p className="err" style={{ margin: "0 8px" }} role="alert">{formErr}</p>}
      <div style={{ margin: "0 4px" }}>
        <button className="cta wide" disabled={busy}>{draft ? "Post to the group" : "Save changes"}</button>
      </div>
    </form>
  );
}

function listWords(xs: string[]) {
  return xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}
