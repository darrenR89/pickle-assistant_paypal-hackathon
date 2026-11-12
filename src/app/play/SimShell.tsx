import Link from "next/link";

// The simulator runs full screen on the landing page's mesh, like the hero's video preview: no site header, just a
// close button back to the landing page. The controls run across the top in a full-width bar; the phones sit below.
export default function SimShell({ controls, actions, children }: { controls?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="sp">
      <div className="sp-bg" aria-hidden="true">
        <div className="lp-mesh"><i /><i /><i /><i /></div>
        <div className="lp-grain" />
      </div>
      <header className="sp-bar">
        <div className="sp-bar-top">
          <div className="sp-title">
            <h1>Full simulator</h1>
            <p>Act as anyone in a simulated group chat. The assistant’s replies are real; PayPal and Venmo holds are real sandbox transactions.</p>
          </div>
          <div className="sp-acts">
            {actions}
            <Link href="/" className="sp-exit">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              <span>Close<span className="sp-wide"> simulator</span></span>
            </Link>
          </div>
        </div>
        {controls}
      </header>
      <main className="sp-main">{children}</main>
    </div>
  );
}
