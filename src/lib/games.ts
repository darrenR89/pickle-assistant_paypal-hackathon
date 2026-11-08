// Placeholder game data until the database lands (build plan: Saturday).
// The server decides the price; the browser never sends an amount.

export type Game = {
  slug: string;
  title: string;
  when: string;
  where: string;
  spots: number;
  shareCents: number;
  freeCancelUntil: string;
};

const games: Record<string, Game> = {
  "thu-6pm": {
    slug: "thu-6pm",
    title: "Thursday pickleball",
    when: "Thu 6:00pm",
    where: "Riverside courts 3–4",
    spots: 8,
    shareCents: 800,
    freeCancelUntil: "Wed 6pm",
  },
};

export function getGame(slug: string): Game | undefined {
  return games[slug];
}

export function formatCents(cents: number) {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}
