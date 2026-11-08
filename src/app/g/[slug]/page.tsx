import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatCents, getGame } from "@/lib/games";
import HoldButton from "./HoldButton";

// Read PAYPAL_CLIENT_ID at request time, not build time.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const game = getGame((await params).slug);
  if (!game) return {};
  const title = `${game.when} · ${game.where}`;
  const description = `${game.spots} spots · ${formatCents(game.shareCents)} each, free cancel until ${game.freeCancelUntil}`;
  // Open Graph tags drive the rich link preview in Messages and WhatsApp.
  return { title, description, openGraph: { title, description } };
}

export default async function GamePage({ params }: Props) {
  const game = getGame((await params).slug);
  if (!game) notFound();
  const price = formatCents(game.shareCents);

  return (
    <main>
      <h1>{game.when}</h1>
      <p className="muted">{game.where}</p>

      <div className="card">
        <div className="row">
          <span>Spots</span>
          <span>{game.spots}</span>
        </div>
        <div className="row">
          <span>Your share</span>
          <span>{price}</span>
        </div>
        <div className="row">
          <span>Free cancel until</span>
          <span>{game.freeCancelUntil}</span>
        </div>
      </div>

      <div className="card">
        <p>
          <strong>I&apos;m in · {price} hold</strong>
        </p>
        <p className="muted">
          Your {price} is held, not charged. Cancel before {game.freeCancelUntil} and it&apos;s released.
        </p>
        <HoldButton slug={game.slug} clientId={process.env.PAYPAL_CLIENT_ID ?? ""} />
      </div>
    </main>
  );
}
