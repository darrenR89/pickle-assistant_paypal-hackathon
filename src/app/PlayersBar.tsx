/** One segment per spot: filled for each player in, outlined when open. */
export default function PlayersBar({ filled, total }: { filled: number; total: number }) {
  const left = Math.max(0, total - filled);
  return (
    <>
      <span className="players-line">
        <span>
          <b>
            {filled}/{total}
          </b>{" "}
          players in
        </span>
        <span className="players-left">{left === 0 ? "Full" : `${left} spot${left === 1 ? "" : "s"} left`}</span>
      </span>
      <span className="segments" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={i < filled ? "on" : undefined} />
        ))}
      </span>
    </>
  );
}
