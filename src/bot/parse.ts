import Anthropic from "@anthropic-ai/sdk";
import { TZ } from "@/lib/games";

export type ParsedGame = {
  startsAt?: Date;
  place?: string;
  address?: string;
  spots?: number;
  priceCents?: number;
  priceIsTotal?: boolean;
  missing: string[];
};

const MODEL = "claude-haiku-5-5";

/** Turn "Thu 6pm Riverside courts 3-4, 8 spots, $64" into game fields. Claude first, regex fallback. */
export async function parseGameRequest(text: string, now = new Date()): Promise<ParsedGame> {
  const cleaned = text.replace(/@\w+/g, "").trim();
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await parseWithClaude(cleaned, now);
    } catch (err) {
      console.error("Claude parse failed, using fallback", err);
    }
  }
  return parseWithRules(cleaned, now);
}

async function parseWithClaude(text: string, now: Date): Promise<ParsedGame> {
  const client = new Anthropic();
  const nowLocal = new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: TZ,
  }).format(now);
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system:
      `You extract pickleball game details from a group-chat message. It is now ${nowLocal} (${TZ}). ` +
      `Resolve day names to the next upcoming date. Return starts_at as ISO 8601 with the correct ${TZ} UTC offset. ` +
      `A price like "$64" for the court is a total; "$8 each" or "$8 pp" is per person. ` +
      `List any of starts_at, place, spots, price that the message does not give in "missing". Never invent values.`,
    tools: [
      {
        name: "create_game",
        description: "Structured game details",
        input_schema: {
          type: "object",
          properties: {
            starts_at: { type: "string", description: "ISO 8601 with UTC offset" },
            place: { type: "string", description: "Court or venue, as written" },
            address: { type: "string", description: "Street address, only if the message includes one. Never look one up or invent it." },
            spots: { type: "integer" },
            price_cents: { type: "integer" },
            price_is_total: { type: "boolean" },
            missing: { type: "array", items: { type: "string" } },
          },
          required: ["missing"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "create_game" },
    messages: [{ role: "user", content: text }],
  });
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("No tool call");
  const input = block.input as {
    starts_at?: string;
    place?: string;
    address?: string;
    spots?: number;
    price_cents?: number;
    price_is_total?: boolean;
    missing?: string[];
  };
  const startsAt = input.starts_at ? new Date(input.starts_at) : undefined;
  return {
    startsAt: startsAt && !Number.isNaN(startsAt.getTime()) ? startsAt : undefined,
    place: input.place?.trim() || undefined,
    address: input.address?.trim() || undefined,
    spots: input.spots && input.spots > 0 ? input.spots : undefined,
    priceCents: input.price_cents && input.price_cents > 0 ? input.price_cents : undefined,
    priceIsTotal: input.price_is_total ?? true,
    missing: input.missing ?? [],
  };
}

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function parseWithRules(text: string, now: Date): ParsedGame {
  let rest = ` ${text} `;
  const take = (re: RegExp) => {
    const m = rest.match(re);
    if (m) rest = rest.replace(m[0], " ");
    return m;
  };

  // Street address first, so its house number isn't read as a time.
  const address = take(
    /\b\d{2,6}\s+(?:[A-Za-z0-9.']+\s){0,4}?(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Blvd|Boulevard|Way|Ln|Lane|Pl|Place|Ct|Court|Pkwy|Parkway|Hwy)\b\.?/i,
  );
  const price = take(/\$\s?(\d+(?:\.\d{1,2})?)\s*(each|pp|per person|a head|\/person)?/i);
  const spots = take(/(\d+)\s*(spots|players|people|ppl)\b/i);
  const day = take(/\b(today|tonight|tomorrow|sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/i);
  const time = take(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);

  let startsAt: Date | undefined;
  if (day || time) {
    const local = localParts(now);
    let addDays = 0;
    const d = day?.[1].toLowerCase();
    if (d === "tomorrow") addDays = 1;
    else if (d && DAYS.includes(d.slice(0, 3))) {
      addDays = (DAYS.indexOf(d.slice(0, 3)) - local.weekday + 7) % 7;
    }
    let hour = time ? Number(time[1]) : 18;
    const minute = time?.[2] ? Number(time[2]) : 0;
    const ampm = time?.[3]?.toLowerCase();
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    if (!ampm && hour >= 1 && hour <= 11) hour += 12; // "6" means 6pm for pickleball
    startsAt = zonedTime(local.year, local.month, local.day + addDays, hour, minute);
    if (startsAt.getTime() < now.getTime()) startsAt = new Date(startsAt.getTime() + 7 * 86400_000);
  }

  const place = rest
    .replace(/[,·]/g, " ")
    .replace(/\bpickleball\b/gi, " ")
    .replace(/\b(at|game|pickleball|courts?)\b(?=\s*$)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const parsed: ParsedGame = {
    startsAt,
    place: place || undefined,
    address: address?.[0].replace(/\.$/, "").trim(),
    spots: spots ? Number(spots[1]) : undefined,
    priceCents: price ? Math.round(Number(price[1]) * 100) : undefined,
    priceIsTotal: price ? !price[2] : true,
    missing: [],
  };
  if (!parsed.startsAt) parsed.missing.push("starts_at");
  if (!parsed.place) parsed.missing.push("place");
  if (!parsed.spots) parsed.missing.push("spots");
  if (!parsed.priceCents) parsed.missing.push("price");
  return parsed;
}

function localParts(d: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      weekday: "short",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: DAYS.indexOf(String(parts.weekday).toLowerCase().slice(0, 3)),
  };
}

/** A wall-clock time in TZ as a real Date. */
export function zonedTime(year: number, month: number, day: number, hour: number, minute: number) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const asLocal = new Date(guess.toLocaleString("en-US", { timeZone: TZ }));
  const asUtc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess.getTime() + (asUtc.getTime() - asLocal.getTime()));
}
