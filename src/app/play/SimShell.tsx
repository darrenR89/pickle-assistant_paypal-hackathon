import Link from "next/link";
import IslandNav from "../landing/IslandNav";
import Logo from "../Logo";

const REPO = "https://github.com/darrenR89/pickle-assistant_paypal-hackathon";

// The landing page's header, mesh band and footer around the simulator, so /play reads as part of the same site.
// The phones inside keep an iMessage look on purpose: that's where the assistant lives in real use.
export default function SimShell({ lead, children }: { lead?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="lp sp">
      <IslandNav repo={REPO} base="/" />
      <main>
        <section className="sp-top" id="top" aria-labelledby="sp-h">
          <div className="lp-mesh" aria-hidden="true"><i /><i /><i /><i /></div>
          <div className="lp-grain" aria-hidden="true" />
          <div className="sp-top-copy">
            <p className="lp-eyebrow">Full simulator · PayPal sandbox</p>
            <h1 id="sp-h">Play the whole group chat.</h1>
            <p className="sp-lead">
              {lead ??
                "Act as anyone in a simulated group, send the assistant real messages and move the clock. In real use it lives in your iMessage or WhatsApp group. PayPal and Venmo holds are real sandbox transactions."}
            </p>
          </div>
        </section>
        {children}
      </main>
      <footer className="lp-foot">
        <Logo className="lp-foot-logo" />
        <span>Built for the PayPal AI Hackathon 2026. Sandbox only: no real money moves.</span>
        <span>
          <a href={REPO}>GitHub</a> · <a href={`${REPO}/blob/main/JUDGES.md`}>For judges</a> · <Link href="/demo">Live phone demo</Link>
        </span>
      </footer>
    </div>
  );
}
