"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// Gives each visitor their own sample group chat, remembered in this browser.
export default function PlayStart() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("playGroup");
    } catch {}
    if (saved) {
      router.replace(`/play/${saved}`);
      return;
    }
    fetch("/api/play/groups", { method: "POST" })
      .then((r) => r.json())
      .then((b) => {
        if (!b.groupId) throw new Error(b.error ?? "Couldn't start a group");
        try {
          localStorage.setItem("playGroup", b.groupId);
        } catch {}
        router.replace(`/play/${b.groupId}`);
      })
      .catch((e: Error) => setError(e.message));
  }, [router]);

  return (
    <div className="sim">
      <div className="sim-banner">
        <strong>Demo simulator.</strong> {error ?? "Setting up a simulated group chat…"}
      </div>
    </div>
  );
}
