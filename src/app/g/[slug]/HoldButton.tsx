"use client";

import { useEffect, useRef, useState } from "react";

// Minimal typing for the parts of the PayPal JS SDK we use.
type PayPalButtons = {
  isEligible(): boolean;
  render(el: HTMLElement): Promise<void>;
  close?: () => Promise<void>;
};
type PayPalNamespace = {
  Buttons(opts: {
    fundingSource?: string;
    style?: Record<string, unknown>;
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

type Hold = { authorizationId: string; status: string; amount?: { value: string }; expiresAt?: string };

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
    script.onload = () => (window.paypal ? resolve(window.paypal) : reject(new Error("PayPal SDK missing")));
    script.onerror = () => reject(new Error("Could not load PayPal"));
    document.head.appendChild(script);
  });
}

export default function HoldButton({ slug, clientId }: { slug: string; clientId: string }) {
  const paypalRef = useRef<HTMLDivElement>(null);
  const venmoRef = useRef<HTMLDivElement>(null);
  const [hold, setHold] = useState<Hold | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) {
      setError("PayPal isn't configured yet (PAYPAL_CLIENT_ID is missing).");
      return;
    }
    let cancelled = false;
    const rendered: PayPalButtons[] = [];

    loadSdk(clientId)
      .then((paypal) => {
        if (cancelled) return;
        const common = {
          createOrder: async () => {
            const res = await fetch("/api/paypal/orders", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ slug }),
            });
            const body = await res.json();
            if (!res.ok) throw new Error(body.error ?? "Could not start the hold");
            return body.id as string;
          },
          onApprove: async ({ orderID }: { orderID: string }) => {
            const res = await fetch(`/api/paypal/orders/${orderID}/authorize`, { method: "POST" });
            const body = await res.json();
            if (!res.ok) throw new Error(body.error ?? "Could not place the hold");
            setHold(body);
          },
          onError: (err: unknown) => setError(err instanceof Error ? err.message : "Payment error"),
        };
        for (const [source, el] of [
          [paypal.FUNDING.PAYPAL, paypalRef.current],
          [paypal.FUNDING.VENMO, venmoRef.current],
        ] as const) {
          if (!el) continue;
          const buttons = paypal.Buttons({ ...common, fundingSource: source, style: { shape: "pill", height: 45 } });
          if (buttons.isEligible()) {
            rendered.push(buttons);
            buttons.render(el).catch(() => {});
          }
        }
      })
      .catch((err: Error) => setError(err.message));

    return () => {
      cancelled = true;
      rendered.forEach((b) => b.close?.().catch(() => {}));
    };
  }, [clientId, slug]);

  if (hold) {
    return (
      <div>
        <p className="status">You&apos;re in. ${hold.amount?.value} is on hold.</p>
        <p className="muted">
          Hold <code>{hold.authorizationId}</code> · {hold.status}
          {hold.expiresAt ? ` · expires ${new Date(hold.expiresAt).toLocaleDateString()}` : ""}
        </p>
      </div>
    );
  }

  return (
    <div>
      {error && <p className="error">{error}</p>}
      <div ref={paypalRef} />
      <div ref={venmoRef} style={{ marginTop: 8 }} />
    </div>
  );
}
