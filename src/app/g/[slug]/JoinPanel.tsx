"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Minimal typing for the parts of the PayPal JS SDK we use.
type PayPalButtons = { isEligible(): boolean; render(el: HTMLElement): Promise<void>; close?: () => Promise<void> };
type PayPalNamespace = {
  Buttons(opts: {
    fundingSource?: string;
    style?: Record<string, unknown>;
    onClick?: (data: unknown, actions: { reject(): void; resolve(): void }) => void;
    createOrder: () => Promise<string>;
    onApprove: (data: { orderID: string }) => Promise<void>;
    onError: (err: unknown) => void;
  }): PayPalButtons;
  FUNDING: { PAYPAL: string; VENMO: string };
};
declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

function loadSdk(clientId: string): Promise<PayPalNamespace> {
  if (window.paypal) return Promise.resolve(window.paypal);
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      "client-id": clientId,
      currency: "USD",
      intent: "authorize",
      components: "buttons",
      "enable-funding": "venmo",
    });
    const script = document.createElement("script");
    script.src = `https://www.paypal.com/sdk/js?${params}`;
    script.onload = () => (window.paypal ? resolve(window.paypal) : reject(new Error("PayPal didn't load")));
    script.onerror = () => reject(new Error("Couldn't load PayPal"));
    document.head.appendChild(script);
  });
}

const money = (c: number) => `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`;

type Props = {
  slug: string;
  clientId: string;
  p?: string;
  viewerName?: string;
  isIn: boolean;
  isOrganizer: boolean;
  holdCents: number;
  shareCents: number;
  capCents: number;
  full: boolean;
  beforeCancelBy: boolean;
  cancelByLabel: string;
  startsAtIso: string;
  place: string;
};

export default function JoinPanel(props: Props) {
  const router = useRouter();
  const paypalRef = useRef<HTMLDivElement>(null);
  const venmoRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const showButtons = !props.isIn && !props.full && !props.isOrganizer;

  useEffect(() => {
    if (!showButtons) return;
    if (!props.clientId) {
      setError("PayPal isn't set up on this server yet.");
      return;
    }
    let cancelled = false;
    const rendered: PayPalButtons[] = [];
    let token = props.p;

    loadSdk(props.clientId)
      .then((paypal) => {
        if (cancelled) return;
        const common = {
          onClick: (_: unknown, actions: { reject(): void; resolve(): void }) => {
            if (!token && (!nameRef.current?.value.trim() || !phoneRef.current?.value.trim())) {
              setError("Add your name and phone number first.");
              return actions.reject();
            }
            setError(null);
            return actions.resolve();
          },
          createOrder: async () => {
            const res = await fetch("/api/paypal/orders", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                slug: props.slug,
                p: token,
                name: nameRef.current?.value,
                phone: phoneRef.current?.value,
              }),
            });
            const body = await res.json();
            if (!res.ok) throw new Error(body.error ?? "Couldn't start the hold");
            token = body.p;
            return body.id as string;
          },
          onApprove: async ({ orderID }: { orderID: string }) => {
            const res = await fetch(`/api/paypal/orders/${orderID}/authorize`, { method: "POST" });
            const body = await res.json();
            if (!res.ok) throw new Error(body.error ?? "Couldn't place the hold");
            // Remember who this is, so the page shows their ticket from now on.
            const url = new URL(window.location.href);
            url.searchParams.set("p", token!);
            router.replace(url.pathname + url.search);
            router.refresh();
          },
          onError: (err: unknown) => setError(err instanceof Error ? err.message : "Payment error"),
        };
        for (const [source, el] of [
          [paypal.FUNDING.PAYPAL, paypalRef.current],
          [paypal.FUNDING.VENMO, venmoRef.current],
        ] as const) {
          if (!el) continue;
          const b = paypal.Buttons({ ...common, fundingSource: source, style: { shape: "pill", height: 55 } });
          if (b.isEligible()) {
            rendered.push(b);
            b.render(el).catch(() => {});
          }
        }
      })
      .catch((err: Error) => setError(err.message));

    return () => {
      cancelled = true;
      rendered.forEach((b) => b.close?.().catch(() => {}));
    };
  }, [showButtons, props.clientId, props.p, props.slug, router]);

  async function cancelSpot() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/games/${props.slug}/out`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p: props.p }),
    });
    setBusy(false);
    if (!res.ok) setError((await res.json()).error ?? "Couldn't cancel");
    router.refresh();
  }

  if (props.isOrganizer) {
    return (
      <div className="card">
        <span className="card-title">You&apos;re the organizer</span>
        <p className="muted" style={{ margin: 0 }}>
          Manage the game from the organizer link in your private messages.
        </p>
      </div>
    );
  }

  if (props.isIn) {
    const extra = Math.max(0, props.holdCents - props.shareCents);
    return (
      <section className="stack">
        <a className="button" href={calendarUrl(props.startsAtIso, props.place)} target="_blank" rel="noreferrer">
          Add to calendar
        </a>
        <button className="secondary" onClick={cancelSpot} disabled={busy}>
          {props.beforeCancelBy ? "Can\u2019t make it · free cancel" : `Can\u2019t make it · organizer decides on your ${money(props.shareCents)}`}
        </button>
        {error && <p className="error">{error}</p>}
        <p className="muted small" style={{ margin: "4px 4px 0" }}>
          {extra > 0 ? `The hold includes up to ${money(extra)} in case the game runs short. ` : ""}
          Money updates come to you privately. The group only sees who&apos;s playing.
        </p>
      </section>
    );
  }

  if (props.full) {
    return (
      <div className="card">
        <span className="card-title">The game is full</span>
        <p className="muted" style={{ margin: 0 }}>
          If someone drops out, the group chat will hear about it.
        </p>
      </div>
    );
  }

  return (
    <section className="card" id="join" aria-labelledby="join-title">
      <div className="card-head">
        <h2 className="card-title" id="join-title" style={{ margin: 0 }}>
          I&apos;m in · {money(props.shareCents)}
        </h2>
        {props.p && props.viewerName && <span className="muted small">as {props.viewerName}</span>}
      </div>
      <div className="ledger">
        <Row k="Your share" v={money(props.shareCents)} />
        <Row k="If the game runs short" v={`up to ${money(props.capCents)}`} />
        <Row k="Held today" v={money(props.shareCents + props.capCents)} strong />
        <Row k="Charged now" v="$0" />
      </div>
      {!props.p && (
        <div className="fields">
          <label>
            Your name
            <input ref={nameRef} autoComplete="given-name" />
          </label>
          <label>
            Phone number
            <input ref={phoneRef} type="tel" autoComplete="tel" />
          </label>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <div ref={paypalRef} />
      <div ref={venmoRef} />
      <p className="muted small" style={{ margin: 0 }}>
        Approving the hold is how you say you&apos;re in. Held, not charged, until after the game. Free cancel until{" "}
        {props.cancelByLabel}.
      </p>
    </section>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="row">
      <span>{k}</span>
      <span className={strong ? "amt strong" : "amt"}>{v}</span>
    </div>
  );
}

function calendarUrl(startIso: string, place: string) {
  const start = new Date(startIso);
  const end = new Date(start.getTime() + 2 * 3600_000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: "Pickleball",
    dates: `${fmt(start)}/${fmt(end)}`,
    location: place,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}
