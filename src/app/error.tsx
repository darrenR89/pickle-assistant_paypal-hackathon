"use client";

import { useEffect } from "react";
import Logo from "./Logo";

// Shown when a page fails to load on the server (for example the database is waking up). Nothing about money is
// decided here: a hold or charge either reached PayPal or it didn't, and reloading the page shows which.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="dp dp-center">
      <div className="dp-join" role="alert">
        <Logo variant="stacked" tone="light" className="dp-logo" />
        <h1 className="dp-h1">Something went wrong.</h1>
        <p className="dp-lead">The page didn’t load. Nothing was charged by this error. Try again in a moment.</p>
        <button type="button" className="dp-btn" onClick={reset}>
          Try again
        </button>
      </div>
    </main>
  );
}
