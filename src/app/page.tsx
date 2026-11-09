import Link from "next/link";

export default function Home() {
  return (
    <div className="app">
      <header className="hdr" style={{ paddingBottom: 26 }}>
        <div className="eyebrow">
          <span className="d">PayPal AI Hackathon</span>
          <span className="div" aria-hidden="true" />
          <span className="t">Sandbox</span>
        </div>
        <h1 style={{ margin: "6px 0 0", textAlign: "center", font: "800 58px/0.92 var(--cond)", color: "#fff", textTransform: "uppercase", letterSpacing: "-.01em" }}>
          Pickleball,
          <br />
          settled.
        </h1>
        <span className="facts" style={{ maxWidth: 330 }}>
          An assistant in your group chat that holds each player’s share with PayPal or Venmo and settles after the game.
        </span>
      </header>
      <main className="scroll" style={{ paddingBottom: 40 }}>
        <section className="card">
          <div className="ledger">
            <div><span>Saying you’re in and the PayPal or Venmo hold</span><span className="em">one tap</span></div>
            <div><span>Money details in the group chat</span><span>never</span></div>
            <div><span>Reminders, settling and renewing holds</span><span>automatic</span></div>
            <div><span>Talk to it like a friend: “can Dana take my spot?”</span><span>Claude</span></div>
          </div>
        </section>
        <Link className="cta wide" href="/play" style={{ display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>
          Try the demo group chat
        </Link>
        <p className="sh-p" style={{ fontSize: 15, margin: "0 6px" }}>
          A simulated group of seven friends. Start a game as Alex, then join as the others with PayPal sandbox accounts.
        </p>
      </main>
    </div>
  );
}
