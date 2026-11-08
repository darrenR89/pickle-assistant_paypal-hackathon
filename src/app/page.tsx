import Link from "next/link";

export default function Home() {
  return (
    <main>
      <p className="eyebrow">PayPal AI Hackathon · work in progress</p>
      <h1>Pickleball assistant</h1>
      <p className="muted">
        Lives in your group chat. Saying you&apos;re in and putting a PayPal or Venmo hold on your share are one tap, so the
        organizer never fronts the court. After the game, it settles itself.
      </p>
      <div className="card">
        <p>
          <strong>Try it in a sample group chat</strong>
        </p>
        <p className="muted small">
          You can switch between seven friends. Create a game as Alex, then join as the others with PayPal sandbox
          accounts.
        </p>
        <Link href="/play">
          <button>Open the playground</button>
        </Link>
      </div>
    </main>
  );
}
