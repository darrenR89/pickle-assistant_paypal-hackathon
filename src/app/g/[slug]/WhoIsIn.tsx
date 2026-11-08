"use client";

import { useRef } from "react";
import Ring from "../../Ring";

type Props = {
  names: Array<{ name: string; organizer: boolean }>;
  spots: number;
  /** "ring": the header's progress ring. "link": a short line with a See all button. */
  variant: "ring" | "link";
};

// Anyone can see who's playing. Names only: money never appears here.
export default function WhoIsIn({ names, spots, variant }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const open = () => ref.current?.showModal();
  const close = () => ref.current?.close();
  const left = Math.max(0, spots - names.length);

  const preview =
    names.length <= 3
      ? names.map((n) => n.name).join(", ")
      : `${names
          .slice(0, 3)
          .map((n) => n.name)
          .join(", ")} + ${names.length - 3} more`;

  return (
    <>
      {variant === "ring" ? (
        <button type="button" className="ring-button" onClick={open} aria-label={`${names.length} of ${spots} in. See who's in`}>
          <Ring filled={names.length} total={spots} />
        </button>
      ) : (
        <div className="whos-in-line">
          <span>
            <span className="label">Who&apos;s in</span>
            <span className="whos-in-names">{preview}</span>
          </span>
          <button type="button" className="secondary small-button" onClick={open}>
            See all
          </button>
        </div>
      )}

      <dialog ref={ref} className="sheet" aria-labelledby="whos-in-title" onClick={(e) => e.target === ref.current && close()}>
        <div className="sheet-inner">
          <div className="sheet-head">
            <h2 id="whos-in-title">
              Who&apos;s in <span className="count">{names.length} of {spots}</span>
            </h2>
            <button type="button" className="secondary small-button" onClick={close}>
              Close
            </button>
          </div>
          <div className="ledger">
            {names.map((n, i) => (
              <div key={i} className="row">
                <span>{n.name}</span>
                <span className="amt">{n.organizer ? "organizer" : "in"}</span>
              </div>
            ))}
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            {left > 0 ? `${left} spot${left === 1 ? "" : "s"} open. ` : "The game is full. "}
            Only names are shown here; money stays private.
          </p>
        </div>
      </dialog>
    </>
  );
}
