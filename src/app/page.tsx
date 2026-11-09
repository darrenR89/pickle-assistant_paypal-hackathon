import Link from "next/link";
import PlayersBar from "./PlayersBar";

export default function Home() {
  return (
    <main>
      <header className="hero">
        <span className="kicker">PayPal AI Hackathon · work in progress</span>
        <h1 className="big-time words">
          Pickleball,
          <br />
          settled.
        </h1>
        <span className="hero-sub">An assistant in your group chat that holds each player&apos;s share and settles after the game.</span>
        <div className="players" aria-label="Example: 6 of 8 players in" role="img" style={{ cursor: "default" }}>
          <PlayersBar filled={6} total={8} />
        </div>
      </header>
      <div className="body">
        <div className="ledger card home-points">
          <div className="row">
            <span>Saying you&apos;re in and the PayPal or Venmo hold</span>
            <span className="amt strong">one tap</span>
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
        <Link className="button" href="/play">
          Try it in a sample group chat
        </Link>
        <p className="muted small" style={{ margin: 0 }}>
          Switch between seven friends. Create a game as Alex, then join as the others with PayPal sandbox accounts.
        </p>
      </div>
    </main>
  );
}
