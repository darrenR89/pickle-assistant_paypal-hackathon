// Free-form group-chat understanding.
//
// People don't type commands. They say "ugh I can't make thursday", "can Dana take my spot?",
// "what time again?", "running 10 late". This module decides what (if anything) each message
// means for the game, then hands off to deterministic code.
//
// Guardrails, enforced in code rather than trusted to the model:
// - The model only picks an action from a fixed list and drafts short replies. It never moves money.
// - Who may do what is checked here (only the organizer can change or call off a game, and even
//   then the change is confirmed on their private link).
// - Names are resolved against the group's real members; an unknown or ambiguous name gets a question.
// - Nobody's money is ever discussed in the group. Money questions get a private answer.
// - Low confidence means a short clarifying question, or silence for small talk.

import Anthropic from "@anthropic-ai/sdk";
import { q } from "@/lib/db";
import { type Game, TZ, inPlayers, inviteeNames, isBeforeCancelBy, money, personById, roster, whenLabel } from "@/lib/games";
import { CLAUDE_MODEL } from "./model";

export type Action =
  | "ignore" // small talk, or not about the game
  | "join" // the sender wants to play
  | "leave" // the sender can't make it
  | "maybe" // tentative ("probably", "maybe if work lets out")
  | "waitlist" // wants the next open spot
  | "give_spot" // hand their spot to someone named
  | "invite" // bring someone who isn't in the group yet, or a +1
  | "answer" // a question the game facts can answer
  | "private_money" // asking about their own money: answer privately, never in the group
  | "change_request" // organizer wants to change time, place, price, spots or free-cancel
  | "call_off" // organizer wants to cancel the game
  | "ask_organizer" // a question only the organizer can answer (parking, ball type, rules)
  | "clarify" // too ambiguous to act on safely
  | "help";

export type Decision = {
  action: Action;
  target?: string; // a person's name for give_spot / invite
  field?: "time" | "place" | "price" | "spots" | "cancel_by" | "other";
  value?: string;
  reply?: string; // what the assistant should say, if anything (group-safe, no money details)
  confidence: number;
  source: "claude" | "rules";
};

export type GroupContext = {
  game: Game | undefined;
  sender: { id: string; name: string };
  isOrganizer: boolean;
  members: string[];
  inNames: string[];
  waitlist: string[];
  invited: string[];
  recent: Array<{ from: string; text: string }>;
};

// ---------- should the assistant even look at this message? ----------

const MENTION = /@(assistant|pickle\w*|bot)\b/i;
const GAME_WORDS =
  /\b(in|out|play(ing)?|spot|spots|court|courts|game|tonight|tomorrow|mon|tue|wed|thu|fri|sat|sun\w*|time|when|where|cancel|sub|swap|take my|waitlist|wait list|late|running|eta|who'?s|how many|price|cost|pay|paid|charge|refund|venmo|paypal|hold|partner|doubles|singles|level|park|parking|address|rain|weather|can'?t|cannot|make it|maybe|count me|\+1|bring|friend|guest|down|bail|sick|injured|hurt|tweaked|move|moving|push|reschedule|change|switch|later|earlier|\d{1,2}\s?(am|pm)|help|rain|rained|off|lights?|nets?|balls?|paddles?|bathrooms?|restrooms?|weather|forecast|smoke|still on|invite|add)\b/i;

/** Cheap filter so most chatter never reaches the model (cost and latency). */
export function worthReading(text: string, assistantSpokeRecently: boolean) {
  if (MENTION.test(text)) return true;
  if (text.length > 400) return false;
  return GAME_WORDS.test(text) || (assistantSpokeRecently && /\?|^(yes|yeah|yep|no|nope|ok|sure)\b/i.test(text));
}

// ---------- understanding ----------

export async function understand(ctx: GroupContext, text: string): Promise<Decision> {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await withClaude(ctx, text);
    } catch (err) {
      console.error("agent: Claude failed, using rules", err);
    }
  }
  return withRules(ctx, text);
}

function facts(ctx: GroupContext) {
  const g = ctx.game;
  if (!g) return "There is no open game right now.";
  const left = g.spots - ctx.inNames.length;
  return [
    `Game: ${whenLabel(g.starts_at)} (${TZ}) at ${g.place}${g.address ? `, ${g.address}` : ""}.`,
    `Spots: ${g.spots}. In (${ctx.inNames.length}): ${ctx.inNames.join(", ") || "nobody yet"}. ${left > 0 ? `${left} left.` : "Full."}`,
    ctx.waitlist.length ? `Waitlist: ${ctx.waitlist.join(", ")}.` : "",
    g.invite_only ? `Invite-only. Invited: ${ctx.invited.join(", ")}. Only the organizer can invite more (use invite with the name).` : "",
    g.kind ? `Type: ${g.kind}${g.partners ? `, ${g.partners} partners` : ""}${g.level ? `, level ${g.level}` : ""}${g.setting ? `, ${g.setting}` : ""}.` : "",
    `Each player's share: ${money(g.share_cents)}. Free cancel until ${whenLabel(g.cancel_by)} (${isBeforeCancelBy(g) ? "still open" : "has passed"}).`,
    `Joining means approving a PayPal or Venmo hold on the game page. Nothing is charged until after the game.`,
  ]
    .filter(Boolean)
    .join("\n");
}

const ACTIONS: Action[] = [
  "ignore", "join", "leave", "maybe", "waitlist", "give_spot", "invite", "answer", "private_money",
  "change_request", "call_off", "ask_organizer", "clarify", "help",
];

async function withClaude(ctx: GroupContext, text: string): Promise<Decision> {
  const client = new Anthropic();
  const history = ctx.recent.map((m) => `${m.from}: ${m.text}`).join("\n");
  const res = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 300,
    system: [
      "You are the assistant in a friends' pickleball group chat. You keep track of who's playing.",
      "Decide what the newest message means for the game by calling the decide tool once.",
      "Most messages are small talk: choose ignore. Only reply when it helps the group.",
      "Never invent facts. If the facts below don't answer a question about the game, use ask_organizer: it is passed to the organizer privately, so leave reply empty.",
      "ask_organizer covers venue details (parking, lights, bathrooms, nets), equipment (balls, paddles), rules, and whether the game is still on (weather, rain, smoke). Skip it only when the message is already addressed to the organizer by name, or the organizer sent it.",
      "Never mention anyone's money, holds or charges in the group. Money questions about the sender's own payment are private_money.",
      "You cannot move money, refund, or change the game yourself. Changes and cancellations by the organizer are change_request or call_off.",
      "Replies: one or two short, friendly sentences, plain text, no emoji, no markdown. Use first names.",
      `The sender is ${ctx.sender.name}${ctx.isOrganizer ? " (the organizer)" : ""}.`,
      `Group members: ${ctx.members.join(", ")}.`,
      "Facts:",
      facts(ctx),
    ].join("\n"),
    tools: [
      {
        name: "decide",
        description: "What this message means for the game.",
        input_schema: {
          type: "object",
          properties: {
            action: { type: "string", enum: ACTIONS },
            target: { type: "string", description: "Person's first name, for give_spot or invite" },
            field: { type: "string", enum: ["time", "place", "price", "spots", "cancel_by", "other"] },
            value: { type: "string", description: "The requested new value, as written" },
            reply: { type: "string", description: "Short group-safe reply, or empty to stay quiet" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["action", "confidence"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "decide" },
    messages: [{ role: "user", content: `Recent messages:\n${history}\n\nNewest message, from ${ctx.sender.name}:\n${text}` }],
  });
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("no decision");
  const d = block.input as Partial<Decision>;
  const decision: Decision = {
    action: ACTIONS.includes(d.action as Action) ? (d.action as Action) : "ignore",
    target: d.target?.trim() || undefined,
    field: d.field,
    value: d.value?.trim() || undefined,
    reply: d.reply?.trim().slice(0, 280) || undefined,
    confidence: typeof d.confidence === "number" ? d.confidence : 0.5,
    source: "claude",
  };
  console.log("agent decision", JSON.stringify({ action: decision.action, confidence: decision.confidence, source: "claude" }));
  return decision;
}

/** Works without an API key, and as a safety net if the model call fails. */
export function withRules(ctx: GroupContext, raw: string): Decision {
  const t = raw.toLowerCase().replace(/@\w+/g, "").trim();
  const d = (action: Action, extra: Partial<Decision> = {}): Decision => ({ action, confidence: 0.75, source: "rules", ...extra });
  const name = (re: RegExp) => raw.match(re)?.[1];

  if (/^(help|what can you do)\b/.test(t)) return d("help");
  if (/\b(refund|charged|my hold|did i pay|how much (do|did) i (owe|pay))\b/.test(t)) return d("private_money");
  // Role checks happen when acting, so anyone's request is recognized and answered.
  if (/\b(call(ing)? (it )?off|cancel (the )?game|rained out|not happening)\b/.test(t)) return d("call_off");
  if (/\b(move|moving|change|switch|push|reschedule)\b.*\b(to|at)\b/.test(t)) return d("change_request", { field: /\d/.test(t) ? "time" : "place", value: raw });
  const add = name(/\b(?:invite|add)\s+([A-Z][a-z]+)\b/);
  if (add && ctx.isOrganizer) return d("invite", { target: add });
  const giveTo = name(/(?:can|let|give)\s+([A-Z][a-z]+)\s+(?:have|take)\s+my\s+spot/i) ?? name(/my spot (?:to|goes to)\s+([A-Z][a-z]+)/i);
  if (giveTo) return d("give_spot", { target: giveTo });
  const guest = name(/(?:can|could)\s+(?:my\s+(?:friend|partner|wife|husband|brother|sister|coworker)\s+)?([A-Z][a-z]+)\s+(?:come|join|play)/i);
  if (guest && !ctx.members.some((m) => m.toLowerCase() === guest.toLowerCase())) return d("invite", { target: guest });
  if (/\+1\b.*\b(friend|guest)|bring(ing)? (a )?(friend|guest)/.test(t)) return d("invite");
  if (/\b(wait ?list|next spot|if (a|any) spot opens|if someone drops)\b/.test(t)) return d("waitlist");
  if (/\b(maybe|probably|might|tentative|50\/50|depends)\b/.test(t)) return d("maybe");
  if (/\b(sick|injured|hurt my|tweaked my|tweaked)\b/.test(t) && !/\?/.test(t)) return d("leave", { confidence: 0.6 });
  if (/\b(can'?t|cannot|won'?t) (make|come|play)|\bi'?m out\b|^out\b|drop me|count me out|have to bail|bail(ing)?\b/.test(t)) return d("leave");
  if (/^(in|i'?m in|me|me too|count me in|\+1|i can play|i'?ll play|i'?m down|im down|down|i'?m there|i'?ll be there|sign me up)\b/.test(t)) return d("join");
  if (/\b(running|be) (\d+ (min|mins|minutes) )?late\b|\beta\b|on my way|omw/.test(t)) return d("ignore");
  if (/\b(parking|ball|balls|rules|dupr|lights|bathroom|nets?|rain|raining|weather|smoke|still on)\b/.test(t) && !ctx.isOrganizer) return d("ask_organizer");
  if (/\?/.test(t) && /\b(when|what time|where|who'?s|how many|spots|price|cost|cancel)\b/.test(t)) return d("answer");
  return d("ignore", { confidence: 0.6 });
}

// ---------- context ----------

export async function buildContext(groupId: string, senderId: string, game: Game | undefined): Promise<GroupContext> {
  const sender = await personById(senderId);
  const members = (
    await q<{ name: string }>("select p.name from group_members m join people p on p.id = m.person_id where m.group_id = $1 order by m.position", [groupId])
  ).map((r) => r.name);
  const recent = (
    await q<{ from: string | null; text: string }>(
      `select p.name as from, m.text from messages m left join people p on p.id = m.sender_id
       where m.group_id = $1 and m.dm_to is null order by m.id desc limit 8`,
      [groupId],
    )
  )
    .reverse()
    .map((m) => ({ from: m.from ?? "Assistant", text: m.text }));
  let inNames: string[] = [];
  let waitlist: string[] = [];
  let invited: string[] = [];
  if (game) {
    invited = game.invite_only ? await inviteeNames(game.id) : [];
    inNames = inPlayers(await roster(game.id)).map((e) => e.name);
    waitlist = (
      await q<{ name: string }>(
        "select p.name from intents i join people p on p.id = i.person_id where i.game_id = $1 and i.kind = 'waitlist' order by i.said_at",
        [game.id],
      )
    ).map((r) => r.name);
  }
  return {
    game,
    sender: { id: senderId, name: sender?.name ?? "there" },
    isOrganizer: !!game && game.organizer_id === senderId,
    members,
    inNames,
    waitlist,
    invited,
    recent,
  };
}

/** Match a name the model or a person typed to exactly one group member. */
export function resolveMember(members: string[], typed: string | undefined) {
  if (!typed) return { status: "missing" as const };
  const t = typed.toLowerCase();
  const exact = members.filter((m) => m.toLowerCase() === t);
  if (exact.length === 1) return { status: "one" as const, name: exact[0] };
  const starts = members.filter((m) => m.toLowerCase().startsWith(t) || t.startsWith(m.toLowerCase()));
  if (starts.length === 1) return { status: "one" as const, name: starts[0] };
  return starts.length > 1 ? { status: "many" as const, options: starts } : { status: "none" as const };
}
