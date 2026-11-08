"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { OrganizerData } from "./page";

const money = (c: number) => `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`;

const EVENT_WORDS: Record<string, string> = {
  created: "created the game",
  joined: "is in",
  out: "is out",
  terms_changed: "changed the terms",
  late_cancel_charge: "was charged for a late cancel",
  late_cancel_cover: "was covered for a late cancel",
  settled: "Game settled",
  hold_renewed: "had their hold renewed",
  cancel_by_reminder: "reminder sent",
  cancelled: "cancelled the game",
};

function ago(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

export default function OrganizerPanel({ slug, o, data }: { slug: string; o: string; data: OrganizerData }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [more, setMore] = useState(false);
  const open = data.status === "open";
  const inCount = data.players.filter((p) => p.status === "in").length;

  async function act(action: string, extra: Record<string, unknown> = {}, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    setNote(null);
    const res = await fetch(`/api/games/${slug}/organizer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ o, action, ...extra }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? "Something went wrong");
    if (action === "nudge") setNote(body.nudged ? `Reminded ${body.nudged} in the group.` : "Nobody's waiting to finish.");
    if (action === "terms") setEditing(false);
    router.refresh();
  }

  function saveTerms(form: FormData) {
    act("terms", {
      cancelBy: String(form.get("cancelBy")),
      spots: Number(form.get("spots")),
      totalCents: Math.round(Number(form.get("total")) * 100),
      capCents: Math.round(Number(form.get("cap")) * 100),
    });
  }

  async function share() {
    const url = `${window.location.origin}/g/${slug}`;
    await navigator.clipboard?.writeText(url).catch(() => {});
    setNote("Game link copied.");
  }

  return (
    <>
      <div className="body" style={{ paddingBottom: 8 }}>
        {data.players.some((p) => p.lateCancel === "pending") &&
          data.players
            .filter((p) => p.lateCancel === "pending")
            .map((p) => (
              <section key={p.id} className="card attention">
                <strong>{p.name} cancelled after the free-cancel time</strong>
                <div className="actions">
                  <button disabled={busy} onClick={() => act("late", { spotId: p.id, decision: "charge" })}>
                    Charge {money(data.shareCents)}
                  </button>
                  <button className="secondary" disabled={busy} onClick={() => act("late", { spotId: p.id, decision: "cover" })}>
                    Cover it
                  </button>
                </div>
              </section>
            ))}

        {data.waiting.length > 0 && (
          <p className="muted small" style={{ margin: 0 }}>
            Said &quot;in&quot; but haven&apos;t confirmed: {data.waiting.join(", ")}
          </p>
        )}

        {editing && open && (
          <form className="card" action={saveTerms}>
            <span className="card-title">Terms</span>
            <label>
              Free cancel until
              <input name="cancelBy" type="datetime-local" defaultValue={data.cancelByLocal} />
            </label>
            <label>
              Spots
              <input name="spots" type="number" min={2} max={32} defaultValue={data.spots} />
            </label>
            <label>
              Court cost ($)
              <input name="total" type="number" min={0} step="0.01" defaultValue={data.totalCents / 100} />
            </label>
            <label>
              Short-game extra per player, up to ($)
              <input name="cap" type="number" min={0} step="0.01" defaultValue={data.capCents / 100} />
            </label>
            <p className="muted small" style={{ margin: 0 }}>
              Once someone is in, terms can only change in players&apos; favor.
            </p>
            <button disabled={busy}>Save and post update</button>
          </form>
        )}

        <section>
          <div className="section-head">
            <span className="label">Players</span>
            <span className="rule" />
            <span className="label">Only you see this</span>
          </div>
          <div className="ledger">
            {data.players.map((p) => (
              <div key={p.id} className="row">
                <span>
                  {p.name}
                  {p.isOrganizer ? " (you)" : ""}
                  {p.status === "out" ? " · out" : ""}
                </span>
                <span className={p.holdStatus === "captured" ? "amt strong" : "amt"}>
                  {p.isOrganizer
                    ? "paid the court"
                    : p.lateCancel === "pending"
                      ? "late cancel"
                      : p.holdStatus === "held"
                        ? `${money(p.holdCents ?? 0)} held`
                        : p.holdStatus === "captured"
                          ? `${money(p.capturedCents ?? 0)} charged`
                          : p.holdStatus === "voided"
                            ? "released"
                            : "—"}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="activity">
          <div className="section-head">
            <span className="label">Activity</span>
          </div>
          {data.activity.map((a, i) => (
            <div key={i} className="row">
              <span>{a.kind === "settled" ? EVENT_WORDS.settled : `${a.name ?? "Someone"} ${EVENT_WORDS[a.kind] ?? a.kind.replace(/_/g, " ")}`}</span>
              <span className="when">{ago(a.at)}</span>
            </div>
          ))}
        </section>

        {note && <p className="note">{note}</p>}
        {error && <p className="error">{error}</p>}

        {open && more && (
          <section className="stack">
            <button
              disabled={busy}
              onClick={() => act("settle", {}, "Settle now? Each player is charged their share (plus their part of any gap, up to the cap).")}
            >
              Game&apos;s over: settle up
            </button>
            <button className="danger" disabled={busy} onClick={() => act("cancel", {}, "Cancel the game and release every hold?")}>
              Cancel the game
            </button>
          </section>
        )}
      </div>

      {open && (
        <nav className="bottom-bar" aria-label="Organizer actions">
          <button onClick={() => setEditing((v) => !v)}>Edit terms</button>
          <button disabled={busy} onClick={() => act("nudge")}>
            Nudge
          </button>
          <span className="pill">
            {inCount}/{data.spots} in
          </span>
          <button onClick={share}>Share</button>
          <button onClick={() => setMore((v) => !v)}>More</button>
        </nav>
      )}
    </>
  );
}
