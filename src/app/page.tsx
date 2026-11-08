import Link from "next/link";

export default function Home() {
  return (
    <main>
      <h1>Pickleball assistant</h1>
      <p className="muted">Games that settle themselves. Work in progress for the PayPal AI Hackathon.</p>
      <div className="card">
        <p>
          Sandbox test game: <Link href="/g/thu-6pm">/g/thu-6pm</Link>
        </p>
      </div>
    </main>
  );
}
