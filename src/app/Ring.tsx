/** Spots ring for the dark pass header: filled share of spots, count in the middle. */
export default function Ring({ filled, total, size = 76 }: { filled: number; total: number; size?: number }) {
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  const frac = total > 0 ? Math.min(1, filled / total) : 0;
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${filled} of ${total} spots filled`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--night-line)" strokeWidth={6} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--ball)"
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={`${(c * frac).toFixed(1)} ${c.toFixed(1)}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span aria-hidden="true">
        {filled}/{total}
      </span>
    </div>
  );
}
