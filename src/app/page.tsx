import Link from "next/link";
import Ring from "./Ring";

export default function Home() {
  return (
    <main>
      <header className="pass">
        <div className="pass-top">
          <div className="pass-title">
            <span className="label">PayPal AI Hackathon · work in progress</span>
            <h1>
              Pickleball,
              <br />
              <i>settled.</i>
            </h1>
            <span className="sub">An assistant in your group chat that holds each player&apos;s share and settles after the game.</span>
          </div>
          <Ring filled={6} total={8} />
        </div>
        <div className="tiles">
          <div className="tile">
            <span className="label">Say you&apos;re in</span>
            <span className="value">One tap</span>
          </div>
          <div className="tile">
            <span className="label">Organizer fronts</span>
            <span className="value">$0</span>
          </div>
        </div>
      </header>
      <div className="body">
        <div className="ledger">
          <div className="row">
            <span>Saying you&apos;re in and the PayPal or Venmo hold</span>
            <span className="amt strong">one step</span>
          </div>
          <div className="row">
            <span>Money details in the group chat</span>
            <span className="amt">never</span>
          </div>
          <div className="row">
            <span>Reminders, settling and renewing holds</span>
            <span className="amt">automatic</span>
          </div>
        </div>
        <Link className="button dark" href="/play">
          Try it in a sample group chat
        </Link>
        <p className="muted small" style={{ margin: 0 }}>
          Switch between seven friends. Create a game as Alex, then join as the others with PayPal sandbox accounts.
        </p>
      </div>
    </main>
  );
}
