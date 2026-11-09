// Match details beyond the basics: type, partners, level, length, indoor/outdoor, courts,
// and invite-only lists. Pulled straight from the organizer's words; nothing is guessed except
// the spot/court suggestion, which is always said out loud so the organizer can fix it.

export type Kind = "mixed" | "womens" | "mens" | "any" | "singles";
export type Partners = "rotating" | "fixed";

export type Details = {
  kind?: Kind;
  partners?: Partners;
  level?: string;
  durationMin?: number;
  endHour?: { h: number; m: number };
  setting?: "indoor" | "outdoor";
  courts?: string; // "Courts 3–4", as a label
  courtCount?: number;
  /** "invite only" in plain English: the invite list is whoever is in the chat right now. */
  inviteOnly?: boolean;
  /** Optional: "just Sam, Priya and Jo" narrows it to those people. */
  invitees?: string[];
};

const NOT_NAMES = new Set(["Mon","Tue","Wed","Thu","Fri","Sat","Sun","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday","Today","Tonight","Tomorrow","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Sept","Oct","Nov","Dec","Court","Courts","Mixed","Singles","Doubles","Women","Men","Indoor","Outdoor","Invite","Only","Just","The","Us"]);

export const KIND_LABEL: Record<Kind, string> = {
  mixed: "Mixed doubles",
  womens: "Women’s doubles",
  mens: "Men’s doubles",
  any: "Doubles",
  singles: "Singles",
};

const COURTS_RE = /\bcourts?\s*#?\s*(\d{1,2}(?:\s*(?:-|–|—|&|,|and|\+)\s*\d{1,2}\b)*)/i;
const COUNT_RE = /\b(\d+|one|two|three|four)\s+courts?\b/i;
const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 };

export function extractDetails(text: string): Details {
  const t = text.toLowerCase();
  const d: Details = {};

  if (/\bmixed\b/.test(t)) d.kind = "mixed";
  else if (/\b(women'?s|womens|ladies|ladies'?)\b/.test(t)) d.kind = "womens";
  else if (/\b(men'?s|mens)\b/.test(t)) d.kind = "mens";
  else if (/\bsingles\b/.test(t)) d.kind = "singles";
  else if (/\bdoubles\b/.test(t)) d.kind = "any";

  if (/\b(fixed partners?|set partners?|same partners?|bring (a|your) partner|fixed round ?robin)\b/.test(t)) d.partners = "fixed";
  else if (/\b(rotat\w* partners?|switch partners|mix(ed)? up partners|rotating round ?robin|popcorn)\b/.test(t)) d.partners = "rotating";

  const lvl = text.match(/\b([2-5]\.\d)\s*(?:(?:-|–|to)\s*([2-5]\.\d)|\+)?/);
  if (lvl) d.level = lvl[2] ? `${lvl[1]}–${lvl[2]}` : /\+/.test(lvl[0]) ? `${lvl[1]}+` : lvl[1];
  else if (/\ball levels\b/.test(t)) d.level = "All levels";
  else if (/\bbeginners?\b/.test(t)) d.level = "Beginner";
  else if (/\badvanced\b/.test(t)) d.level = "Advanced";
  else if (/\bintermediate\b/.test(t)) d.level = "Intermediate";

  const hrs = t.match(/\b(\d(?:\.\d)?)\s*(?:hrs?|hours?)\b/);
  const mins = t.match(/\b(\d{2,3})\s*(?:min|mins|minutes)\b/);
  if (hrs) d.durationMin = Math.round(Number(hrs[1]) * 60);
  else if (mins) d.durationMin = Number(mins[1]);
  const range = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(?:am|pm)?\s*(?:-|–|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (range) {
    let h = Number(range[3]);
    if (range[5] === "pm" && h < 12) h += 12;
    d.endHour = { h, m: Number(range[4] ?? 0) };
  }

  if (/\bindoors?\b/.test(t)) d.setting = "indoor";
  else if (/\boutdoors?\b/.test(t)) d.setting = "outdoor";

  const c = text.match(COURTS_RE);
  if (c) {
    const nums = c[1].match(/\d+/g)!.map(Number);
    const isRange = /-|–|—/.test(c[1]) && nums.length === 2 && nums[1] > nums[0];
    d.courtCount = isRange ? nums[1] - nums[0] + 1 : nums.length;
    d.courts = `${d.courtCount > 1 ? "Courts" : "Court"} ${c[1].replace(/\s*(?:-|—)\s*/g, "–").replace(/\s+/g, " ").trim()}`;
  } else {
    const n = text.match(COUNT_RE);
    if (n) d.courtCount = WORDS[n[1].toLowerCase()] ?? Number(n[1]);
  }

  if (/\binvite[- ]only\b|\binvites? only\b|\bprivate game\b|\bjust (us|this group|the group|the crew)\b|\bmembers only\b/i.test(text)) d.inviteOnly = true;
  // Names are optional. Only "just Sam, Priya and Jo" style lists count, and days or places never do.
  const inv = text.match(/\b(?:just|only)\s+(?:for\s+|with\s+)?((?:[A-Z][a-z]+)(?:\s*(?:,|&|and)\s*(?:[A-Z][a-z]+))*)/);
  if (inv) {
    const names = inv[1].split(/\s*(?:,|&|\band\b)\s*/).map((s) => s.trim()).filter((s) => s && !NOT_NAMES.has(s));
    if (names.length) {
      d.invitees = names;
      d.inviteOnly = true;
    }
  }

  return d;
}

/** Remove the courts phrase from a place name: "Riverside Park courts 3–4" → "Riverside Park". */
export function stripCourts(place: string) {
  return place.replace(COURTS_RE, " ").replace(COUNT_RE, " ").replace(/\s{2,}/g, " ").replace(/[\s,·-]+$/, "").trim();
}

export const perCourt = (kind?: Kind) => (kind === "singles" ? 2 : 4);

/** A venue name without the match details that rode along in the same sentence. */
export function cleanPlace(place: string) {
  return stripCourts(place)
    .replace(/\b(mixed|women'?s|womens|ladies|men'?s|mens|any)?\s*(doubles|singles)\b/gi, " ")
    .replace(/\b(fixed|rotating|set|same)\s+partners?\b|\b(fixed|rotating)?\s*round ?robin\b|\bpopcorn\b/gi, " ")
    .replace(/\b(level\s*)?[2-5]\.\d\s*(?:(?:-|–|to)\s*[2-5]\.\d|\+)?/gi, " ")
    .replace(/\b(all levels|beginners?|intermediate|advanced)\b/gi, " ")
    .replace(/\b\d(?:\.\d)?\s*(?:hrs?|hours?)\b|\b\d{2,3}\s*(?:min|mins|minutes)\b/gi, " ")
    .replace(/\b(indoors?|outdoors?)\b/gi, " ")
    .replace(/\binvite[- ]only\b|\binvites? only\b|\bprivate game\b|\bjust (us|this group|the group|the crew)\b|\bmembers only\b/gi, " ")
    .replace(/\b(?:just|only)\s+(?:for\s+|with\s+)?(?:[A-Z][a-z]+)(?:\s*(?:,|&|and)?\s*[A-Z][a-z]+)*/g, (m) => (/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/.test(m) ? m : " "))
    .replace(/(?:\s*[,·-]\s*){2,}/g, ", ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,·:-]+|[\s,·:-]+$/g, "")
    .trim();
}
