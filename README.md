# Paddles In

**The group chat assistant that gets the organizer paid back.**

<!-- Before submission: replace VIDEO_URL with the public YouTube link. -->
**[getpaddlesin.com](https://getpaddlesin.com)** · **[▶ Watch the demo (under 3 min)](VIDEO_URL)** · **[Try it on your phone](https://getpaddlesin.com/demo)** · **[For judges](JUDGES.md)** · **[For AI reviewers](docs/AI-REVIEWERS.md)**

![Pickleball games that settle themselves. Friends hold their spot with PayPal or Venmo, right from the group chat. After the game, everyone pays only their real share. A phone shows the game page with 4 spots left and an I'm in button.](docs/images/hero.webp)

One friend books the court and pays for it, then spends the week asking everyone for $8. Paddles In does that job for them. A hold makes "I'm in" mean something, a late drop is the organizer's call, and the money comes back without anyone having to ask.

## Try it (judges)

1. Open **[getpaddlesin.com/demo](https://getpaddlesin.com/demo)** on a laptop and scan the code with your phone. You're the organizer.
2. Follow the steps on the page. Friends join in the group chat, then you switch to a player and tap **I'm in**.
3. Approve the hold on a computer (PayPal's sandbox checkout doesn't run on phones), signing in as the **PayPal sandbox buyer** shown on the `/demo` page and in [JUDGES.md](JUDGES.md#sandbox-buyer). That hold is real, in PayPal's sandbox.
4. Move the clock past the game and settle. You'll see the player charged only their share, and the organizer paid back.

No phone handy? **[/play](https://getpaddlesin.com/play)** runs the same game in one browser tab.

## How it works

<table>
<tr>
<td width="25%"><img src="public/shots/chat.webp" alt="The group chat: friends say yeah I'm down and count me in, and the assistant replies with a game card."></td>
<td width="25%"><img src="public/shots/in.webp" alt="The game page after joining: You're in, $10 held, charged after the game."></td>
<td width="25%"><img src="public/shots/paid.webp" alt="A player's receipt after the game: you paid $10, your $8 share plus $2 because the game ran short."></td>
<td width="25%"><img src="public/shots/settled.webp" alt="The organizer's settled game: $30 collected and sent as a payout to their Venmo."></td>
</tr>
<tr>
<td><b>1. Say you're in.</b> Friends reply in the group chat like they always do.</td>
<td><b>2. Hold your spot.</b> PayPal or Venmo holds the money. Nothing is charged yet.</td>
<td><b>3. Pay your real share.</b> After the game, each player is charged only what they owe.</td>
<td><b>4. Organizer paid back.</b> The money goes straight to the organizer's Venmo.</td>
</tr>
</table>

Drop out early and your hold is simply released. Drop out late and the organizer decides, privately, whether to charge you or cover it. Nobody's money is ever talked about in the group.

## What we used, and why

| | What it does here, in one sentence |
|---|---|
| **PayPal holds** | Saying "I'm in" puts a hold on your money, like a deposit, so your spot is real but nothing is spent yet. |
| **PayPal partial capture** | After the game, PayPal takes only your share and gives back the rest of the hold. |
| **PayPal refunds** | If someone took your spot after you were charged, the organizer can give your money back in one tap. |
| **PayPal Payouts + Venmo** | All the money collected goes back to the organizer's Venmo or PayPal in one payment. |
| **PayPal webhooks** | PayPal tells us when something changes, like a hold running out, so our records always match. |
| **Claude (Anthropic)** | Claude reads the group chat and works out what people mean, like "yeah I'm down" or "can Lee take my spot?". |
| **Plain code for money** | Claude never decides an amount or moves money. Fixed rules in our code do that. |
| **Render** | Render runs the website and keeps the database of games and players. |
| **Render Workflows** | Render Workflows does the jobs nobody should have to remember: reminders, renewing holds, and settling up after the game. |
| **Sendblue** | Sendblue lets the assistant send and receive real text messages. |
| **Next.js** | Next.js builds the game pages people open from the chat. |

## Proof from a real sandbox run

<!-- Before submission: paste the output of `pnpm proof` here, replacing this comment and the line below. -->
_The table of real sandbox ids from the final run goes here._

**What's real:** Claude reading every message, the game pages, any hold you approve with a sandbox buyer, and the payout. **What's simulated:** the other players in the demo and their holds (ids start with `SIM-`), so a game can fill in seconds.

## For AI reviewers

The full technical brief is in **[docs/AI-REVIEWERS.md](docs/AI-REVIEWERS.md)**: what to read first, the message pipeline, every PayPal call with its idempotency key, the money invariants and how the system recovers. In short:

- **Claude reads, code pays.** Claude (`claude-haiku-5-5`, forced tool calls) only picks one of 14 fixed actions. Deterministic code in `src/bot/assistant.ts` sets every amount and makes every PayPal call.
- **Eight PayPal operations:** create order (`AUTHORIZE`), authorize, void, reauthorize, partial capture, refund, payout, and webhook verification. Every write sends a `PayPal-Request-Id` derived from the object it acts on.
- **Safe to run twice.** Settling claims the game row before charging, webhooks apply once, and Render Workflows finishes anything a restart cut off.
- **Checked on every PR:** typecheck, lint, unit tests and build in CI.

## Run it yourself

```bash
cp .env.example .env      # PayPal sandbox keys, ANTHROPIC_API_KEY, DATABASE_URL
pnpm install
pnpm dev                  # http://localhost:3000/play
```

Webhooks, payouts, Sendblue, Render Workflows and deploy: [docs/SETUP.md](docs/SETUP.md).

## Credits

MIT licence. Built for the PayPal AI Hackathon 2026 with PayPal's developer sandbox, Claude (Anthropic), Next.js and Render; Claude Code helped write the code. Design patterns studied on [Mobbin](https://mobbin.com), then redrawn from scratch. Fonts: Figtree and Barlow Condensed (SIL Open Font License).
