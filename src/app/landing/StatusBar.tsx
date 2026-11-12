// Shared by the landing page screenshots and the simulator phones (/play).
/** iOS-style status bar (time, Dynamic Island, signal, Wi-Fi, battery) so the shots read as a phone. */
export default function StatusBar({ time = "9:41" }: { time?: string }) {
  return (
    <span className="lp-status" aria-hidden="true">
      <span className="lp-status-time">{time}</span>
      <span className="lp-status-island" />
      <span className="lp-status-icons">
        <svg viewBox="0 0 18 12" width="18" height="12">
          <rect x="0" y="8" width="3" height="4" rx="1" />
          <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
          <rect x="10" y="3" width="3" height="9" rx="1" />
          <rect x="15" y="0" width="3" height="12" rx="1" />
        </svg>
        <svg viewBox="0 0 16 12" width="16" height="12">
          <path d="M8 2.6c2.3 0 4.4.9 6 2.4l1.2-1.3A10.4 10.4 0 0 0 8 .8C5.2.8 2.7 1.9.8 3.7L2 5c1.6-1.5 3.7-2.4 6-2.4Z" />
          <path d="M8 6.2c1.3 0 2.5.5 3.4 1.3l1.2-1.3A6.7 6.7 0 0 0 8 4.4c-1.8 0-3.4.7-4.6 1.8l1.2 1.3c.9-.8 2.1-1.3 3.4-1.3Z" />
          <path d="M8 9.8 9.9 8A2.8 2.8 0 0 0 6.1 8L8 9.8Z" transform="translate(0 1)" />
        </svg>
        <svg viewBox="0 0 27 13" width="27" height="13">
          <rect x="0.5" y="0.5" width="23" height="12" rx="3.8" fill="none" stroke="currentColor" strokeOpacity=".4" />
          <rect x="2" y="2" width="20" height="9" rx="2.5" />
          <path d="M25 4.5v4c.8-.3 1.4-1.1 1.4-2s-.6-1.7-1.4-2Z" fillOpacity=".4" />
        </svg>
      </span>
    </span>
  );
}
