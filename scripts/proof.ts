// Print the README's "Proof from a real sandbox run" table for one game, from DATABASE_URL.
// Usage: pnpm proof            (the latest game with a real, non-simulated PayPal hold)
//        pnpm proof <slug>     (a specific game)
// Read-only: it never calls PayPal and never writes to the database.
import { one, q } from "@/lib/db";
import { proofMarkdown, type ProofGame, type ProofSpot, type ProofWebhook } from "@/lib/proof";

async function main() {
  const slug = process.argv[2];
  const game = slug
    ? await one<ProofGame & { id: string }>("select * from games where slug = $1", [slug])
    : await one<ProofGame & { id: string }>(
        `select g.* from games g
         where exists (select 1 from spots s where s.game_id = g.id and s.authorization_id is not null and s.authorization_id not like 'SIM-%')
         order by g.created_at desc limit 1`,
      );
  if (!game) {
    console.error(slug ? `No game with slug ${slug}.` : "No game with a real sandbox hold yet. Place one with a PayPal sandbox buyer first.");
    process.exit(1);
  }
  const spots = await q<ProofSpot>(
    `select p.name, s.order_id, s.authorization_id, s.capture_id, s.hold_cents, s.captured_cents,
            s.refunded_cents, s.hold_status, s.reauthorized
     from spots s join people p on p.id = s.person_id
     where s.game_id = $1 order by s.authorized_at nulls last, s.created_at`,
    [game.id],
  );
  const ids = spots.flatMap((s) => [s.order_id, s.authorization_id, s.capture_id]).concat(game.payout_batch_id).filter((x): x is string => Boolean(x));
  const webhooks = await q<ProofWebhook>(
    // A refund or payout-item event names its own id, so match any of ours anywhere in the payload.
    "select type, count(*)::int as count from webhook_events where payload::text like any($1) group by type order by type",
    [ids.map((id) => `%${id}%`)],
  );
  const md = proofMarkdown(game, spots, webhooks);
  if (!md) {
    console.error(`Game ${game.slug} has no real PayPal objects, only simulated ones.`);
    process.exit(1);
  }
  console.log(md);
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
