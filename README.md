# Pickleball assistant

**An AI assistant in your pickleball group chat. Friends say they're in and hold their spot with PayPal or Venmo; after the game each player is charged their real share.**

Entry for the PayPal AI Hackathon 2026. Runs in the PayPal sandbox.

- **Live site:** https://pickle-assistant.onrender.com
- **Try it on your phone:** https://pickle-assistant.onrender.com/demo (scan the code; you're the organizer, the page plays your friends)
- **For judges:** [JUDGES.md](JUDGES.md) maps each judging criterion to the code that backs it.

## The problem

Rec pickleball is organized in group chats. One person books the court and pays for it, then chases everyone for their share. People say "maybe", drop out late or never pay, and asking for money in the group is awkward.

## What it does

1. **The organizer texts the group:** `@Assistant Thu 6pm Riverside courts 3–4, $64`. Claude turns it into a game (8 spots, $8 each, free cancel until the day before) and posts a link. If details are missing, it starts a draft and asks the organizer privately.
2. **Players hold their spot:** "yeah I'm down" gets them the link; tapping **I'm in** places a PayPal authorization (Orders v2, intent AUTHORIZE) for their share plus a small cap. Nothing is charged.
3. **It handles the messy middle:** free-form replies (out, maybe, waitlist, "can Lee take my spot?", "is there parking?"), late cancels (organizer charges or covers), invite-only games and reminders.
4. **It settles after the game:** each player is captured for their real share; the rest of each hold is released. Money details only ever go to people privately.

## How PayPal and AI are used

| | What | Where |
|---|---|---|
| PayPal | Orders v2 intent AUTHORIZE, authorize, capture (partial), void, reauthorize; idempotent PayPal-Request-Id on every write; PayPal JS SDK buttons with PayPal and Venmo funding | `src/lib/paypal.ts`, `src/app/api/paypal/`, `src/bot/assistant.ts` |
| AI | Claude Haiku 5.5 (Anthropic) with forced tool calls: `create_game` parses a setup message; `decide` interprets every other group message. A rules-based fallback runs if Claude is unavailable | `src/bot/parse.ts`, `src/bot/agent.ts` |
| Boundary | The model only decides what people mean. Every money movement is deterministic code with fixed rules | `src/bot/assistant.ts` |

## What's real in the demo

The phone demo and `/play` simulator use a simulated group chat (real iMessage/WhatsApp delivery is the next step). **Real:** Claude reading every message, the game pages, and any hold you place through the PayPal sandbox, which is authorized, captured or voided against PayPal's API. **Simulated:** the other players and their holds (authorization ids starting with `SIM-`), so a game can fill in seconds.

## Run it locally

Requires Node 22+ and pnpm (`corepack enable`).

```bash
cp .env.example .env      # then fill in your PayPal sandbox keys
pnpm install
pnpm dev                  # http://localhost:3000/play
```

You need a Postgres database (`DATABASE_URL`); tables are created automatically on first request.

Approve the hold with a PayPal sandbox personal account (developer.paypal.com > Sandbox Accounts).

To receive PayPal webhooks while developing, expose your machine with a quick tunnel:

```bash
cloudflared tunnel --url http://localhost:3000
```

## How it works (v1)

- **/demo** pairs your phone: you run the game as organizer while the page plays the group (friends join, you switch to a player and pay, someone cancels late, the game settles).
- **/play** gives you a private sample group chat with seven friends. Switch who you're typing as.
- As Alex, post `@Assistant Thu 6pm Riverside courts 3–4, 8 spots, $64`. The game is posted right away with default terms; Alex gets a private organizer link.
- Anyone who says "in" gets the game link. On the game page, "I'm in" and the PayPal or Venmo hold are one step. Holds cover the share plus a small cap for short games.
- "out" (or "Can't make it" on the page) releases the hold before the free-cancel time; after it, the organizer decides to charge or cover.
- The organizer page shows money progress, players (amounts visible only to the organizer), activity, terms editing, a nudge, and settle or cancel.
- Money details are only sent privately (the playground's inbox), never to the group.

`src/bot/assistant.ts` holds the chat behavior and doesn't depend on the chat channel, so real channels (iMessage through Blooio, via Chat SDK) can call the same functions.

## Scheduled work (Render Workflows)

`src/workflows/tasks.ts` defines Render Workflow tasks with the Render SDK. A cron job (`pnpm trigger`) starts the `tick` task every 10 minutes; `tick` finds what's due and fans out one task run per item:

- `sendCancelByReminder`: one reminder in the group, in the 3 hours before free cancel ends, to people who said "in" but haven't confirmed
- `sendGameDayReminder`: "Game in 2 hours" in the group
- `settleGame`: settles a game 3 hours after it starts if the organizer hasn't
- `reauthorizeHold`: renews a PayPal hold after its 3-day honor period while the game is still ahead

Each task retries on its own and is safe to run twice. `render.workflows.yaml` is the Blueprint for the workflow service and the cron job. Try the logic locally with `pnpm tick:local`.

## Test endpoints (sandbox only)

Release or charge a hold, using the `ADMIN_TOKEN` from your `.env`:

```bash
curl -X POST localhost:3000/api/paypal/authorizations/<id>/void    -H "x-admin-token: $ADMIN_TOKEN"
curl -X POST localhost:3000/api/paypal/authorizations/<id>/capture -H "x-admin-token: $ADMIN_TOKEN"
```

## Deploy

`render.yaml` is a Render Blueprint. Set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `ANTHROPIC_API_KEY` in the Render dashboard; never commit them.

## Credits

Credits for code, templates and design references will be listed here as the project structure settles.

## License

MIT

## Credits

- Design patterns studied on [Mobbin](https://mobbin.com) (event invite pages, app landing pages), then redrawn from scratch.
- Fonts: Figtree and Barlow Condensed (SIL Open Font License), self-hosted via Fontsource.
- Built with Claude (Anthropic), PayPal developer sandbox, Next.js and Render.
