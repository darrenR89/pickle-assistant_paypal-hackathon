# Setup and running it yourself

Everything a developer needs to run, deploy and test Paddles In. The [README](../README.md) is the short version for judges.

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

## Using the simulator

- **/demo** pairs your phone: you run the game as organizer while the page plays the group (friends join, you switch to a player and pay, someone cancels late, the game settles).
- **/play** gives you a private sample group chat with seven friends. Switch who you're typing as.
- As Alex, post `@PaddlesIn Thu 6pm Riverside courts 3–4, 8 spots, $64`. The game is posted right away with default terms; Alex gets a private organizer link.
- Anyone who says "in" gets the game link. On the game page, "I'm in" and the PayPal or Venmo hold are one step. Holds cover the share plus a small cap for short games.
- "out" (or "Can't make it" on the page) releases the hold before the free-cancel time; after it, the organizer decides to charge or cover.
- The organizer page shows money progress, players (amounts visible only to the organizer), activity, terms editing, a nudge, and settle or cancel.
- Money details are only sent privately (the playground's inbox), never to the group.

`src/bot/assistant.ts` holds the chat behavior and doesn't depend on the chat channel, so real texting through Sendblue calls the same functions.

## The phone demo by real text (Sendblue free sandbox)

With `SENDBLUE_API_KEY`, `SENDBLUE_API_SECRET` and `SENDBLUE_FROM_NUMBER` set, `/demo` offers "Or use your own Messages app":

1. The judge types their first name and mobile number. The app adds the number to the Sendblue contacts (the free plan only texts contacts, and allows 10).
2. The page shows a code. Texting `JOIN 1234` to the Sendblue number links that phone to the demo and completes Sendblue's check.
3. Their texts go into the demo's group chat as them (the organizer, or Jo after "Switch my phone to a player"). The assistant's group posts (marked `[Group]`) and their private messages come back as texts, with game links that open as them. The rest of the group stays simulated on the desktop.

The sandbox has no webhooks, so the server checks Sendblue for new texts every 4 seconds (`src/bot/sendblue.ts`, started in `src/instrumentation.ts`). Replies take a few seconds, and the web service must be awake.

## Scheduled work (Render Workflows)

`src/workflows/tasks.ts` defines Render Workflow tasks with the Render SDK. A cron job (`pnpm trigger`) starts the `tick` task every 10 minutes; `tick` finds what's due and fans out one task run per item:

- `sendCancelByReminder`: one reminder in the group, in the 3 hours before free cancel ends, to people who said "in" but haven't confirmed
- `sendGameDayReminder`: "Game in 2 hours" in the group
- `settleGame`: settles a game 3 hours after it starts if the organizer hasn't
- `reauthorizeHold`: renews a PayPal hold after its 3-day honor period while the game is still ahead
- `placeSavedHold` / `freeFailedSpot`: with `DELAYED_HOLDS=on`, places the hold 2 days before a far-off game from the player's saved PayPal, and opens the spot if a refused hold isn't approved again within a day
- `payOrganizer`: retries a payout that failed (up to 3 attempts; the organizer can also tap Retry)

Each task retries on its own and is safe to run twice. `render.workflows.yaml` is the Blueprint for the workflow service and the cron job. Try the logic locally with `pnpm tick:local`.

## Payouts and webhooks

- **Payouts** need the Payouts feature on your PayPal app (developer.paypal.com > your app > Features) and some balance in the sandbox business account. The organizer sets where to be paid on their organizer page; it defaults to their phone number on Venmo. Demo games where every hold is simulated get a simulated payout (`SIM-` batch id).
- **Webhooks:** add a webhook in the PayPal app pointing at `https://<your-app>/api/paypal/webhook`, subscribe to `PAYMENT.AUTHORIZATION.VOIDED`, `PAYMENT.CAPTURE.*` and `PAYMENT.PAYOUTS*` events, and put its ID in `PAYPAL_WEBHOOK_ID`. Every event's signature is checked with PayPal, and each event is applied once.

## Proof table

After a game with a PayPal sandbox buyer, run `pnpm proof` (or `pnpm proof <game-slug>`) with `DATABASE_URL` set. It reads the database only and prints a markdown table of real sandbox ids, never simulated ones.

## Test endpoints (sandbox only)

Release or charge a hold, using the `ADMIN_TOKEN` from your `.env`:

```bash
curl -X POST localhost:3000/api/paypal/authorizations/<id>/void    -H "x-admin-token: $ADMIN_TOKEN"
curl -X POST localhost:3000/api/paypal/authorizations/<id>/capture -H "x-admin-token: $ADMIN_TOKEN"
```

## Deploy

`render.yaml` is a Render Blueprint. Set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `ANTHROPIC_API_KEY` in the Render dashboard; never commit them.
