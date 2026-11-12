import Link from "next/link";
import Logo from "./Logo";

export const metadata = { title: "Page not found · Paddles In" };

// Shown for a game link that doesn't exist (a typo, or a demo game that was cleared) and any other unknown address.
export default function NotFound() {
  return (
    <main className="dp dp-center">
      <div className="dp-join">
        <Logo variant="stacked" tone="light" className="dp-logo" />
        <h1 className="dp-h1">We couldn’t find that page.</h1>
        <p className="dp-lead">The link may be mistyped, or the game it pointed to is no longer here. Ask your organizer for a fresh link, or try the live demo.</p>
        <Link href="/demo" className="dp-btn" style={{ display: "grid", placeItems: "center", textDecoration: "none" }}>
          Open the live demo
        </Link>
        <Link href="/">Back to the home page</Link>
      </div>
    </main>
  );
}
