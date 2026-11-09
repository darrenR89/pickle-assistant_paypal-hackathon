"use client";

import { useRef } from "react";
import PlayersBar from "../../PlayersBar";

type Props = {
  names: Array<{ name: string; organizer: boolean }>;
  spots: number;
};

// Anyone can see who's playing. Names only: money never appears here.
export default function WhoIsIn({ names, spots }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const open = () => ref.current?.showModal();
  const close = () => ref.current?.close();
  const left = Math.max(0, spots - names.length);

  return (
    <>
      <button
        type="button"
        className="players"
        onClick={open}
        aria-haspopup="dialog"
        aria-label={`${names.length} of ${spots} players in, ${left} open. See who's in`}
      >
        <PlayersBar filled={names.length} total={spots} />
        <span className="see">See who&apos;s in</span>
      </button>

      <dialog ref={ref} className="sheet" aria-labelledby="whos-in-title" onClick={(e) => e.target === ref.current && close()}>
        <span className="sheet-grab" aria-hidden="true" />
        <div className="sheet-inner">
          <div className="sheet-head">
            <h2 id="whos-in-title">
              Who&apos;s in · {names.length} of {spots}
            </h2>
            <button type="button" className="small-button" onClick={close}>
              Done
            </button>
          </div>
          <CourtMap names={names.map((n) => n.name)} spots={spots} />
          <div className="people">
            {names.map((n, i) => (
              <div key={i} className="person">
                <span className="avatar" aria-hidden="true">
                  {initial(n.name)}
                </span>
                <span className="person-name">
                  {n.name}
                  {n.organizer ? " (organizer)" : ""}
                </span>
                <span className="person-tag">In</span>
              </div>
            ))}
            {Array.from({ length: left }, (_, i) => (
              <div key={`open-${i}`} className="person open">
                <span className="avatar open" aria-hidden="true" />
                <span className="person-name">Open spot</span>
              </div>
            ))}
          </div>
          <p className="muted small" style={{ margin: "0 8px" }}>
            Only names are shown here. Money stays private.
          </p>
        </div>
      </dialog>
    </>
  );
}

const initial = (name: string) => name.trim().charAt(0).toUpperCase() || "?";

/** Courts seen from above, four positions each. Players fill positions in the order they joined. */
function CourtMap({ names, spots }: { names: string[]; spots: number }) {
  const courts = Math.max(1, Math.ceil(spots / 4));
  return (
    <div className="court-map" role="img" aria-label={`${names.length} of ${spots} spots filled across ${courts} court${courts === 1 ? "" : "s"}`}>
      {Array.from({ length: courts }, (_, c) => (
        <svg key={c} viewBox="0 0 170 140" aria-hidden="true">
          <rect x="2" y="6" width="166" height="128" rx="6" fill="none" stroke="var(--on-mesh-muted)" strokeWidth="2" />
          <line x1="85" y1="2" x2="85" y2="138" stroke="var(--on-mesh)" strokeWidth="3" />
          <line x1="62" y1="6" x2="62" y2="134" stroke="var(--on-mesh-muted)" strokeWidth="1.5" />
          <line x1="108" y1="6" x2="108" y2="134" stroke="var(--on-mesh-muted)" strokeWidth="1.5" />
          {[
            [40, 38],
            [40, 102],
            [130, 38],
            [130, 102],
          ].map(([cx, cy], p) => {
            const i = c * 4 + p;
            if (i >= spots) return null;
            const name = names[i];
            return name ? (
              <g key={p}>
                <circle cx={cx} cy={cy} r="20" fill="var(--ball)" />
                <text x={cx} y={cy + 6} textAnchor="middle" fontFamily="Figtree, sans-serif" fontWeight="800" fontSize="17" fill="#171428">
                  {initial(name)}
                </text>
              </g>
            ) : (
              <circle key={p} cx={cx} cy={cy} r="19" fill="none" stroke="var(--on-mesh-muted)" strokeWidth="2" strokeDasharray="4 4" />
            );
          })}
        </svg>
      ))}
    </div>
  );
}
