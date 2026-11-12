# For judges

A short map from each judging criterion to what you can try and the code behind it. Everything runs in the PayPal sandbox; no real money moves.

**Fastest way to see it:** open https://pickle-assistant.onrender.com/demo on a computer and scan the code with your phone (or open it on your phone and use **Demo steps**). You organize a game; the page plays the rest of the group. About two minutes.

| | |
|---|---|
| Video (under 3 min) | <!-- Before submission: replace VIDEO_URL --> [Watch on YouTube](VIDEO_URL) |
| Live demo, no keys | https://pickle-assistant.onrender.com/play (one-tap game scenarios) |
| Every PayPal call | [docs/PAYPAL.md](docs/PAYPAL.md) |
| Real sandbox ids from one full game | [README: Proof from a real sandbox run](README.md#proof-from-a-real-sandbox-run) |
| Sandbox buyer to approve a hold | shown on the `/demo` page |

## Technological implementation

- **PayPal Orders v2 with intent AUTHORIZE.** Joining creates an order for the share plus a cap, then authorizes it: `createHoldOrder`, `authorizeOrder` in `src/lib/paypal.ts`; routes `src/app/api/paypal/orders/route.ts` and `src/app/api/paypal/orders/[id]/authorize/route.ts`.
- **Release, renew, charge.** `voidAuthorization` (free cancel), `reauthorize` (after PayPal's 3-day honor period, scheduled in `src/workflows/tasks.ts`), `captureAuthorization` with a partial amount at settle-up: `settleGame` / `settleClaimed` in `src/bot/assistant.ts`.
- **Recovers by itself.** A hold PayPal can no longer charge is skipped and the organizer is told, so one bad hold can't block a settle (`chargeHold` in `src/bot/assistant.ts`). A settle, call-off or payout cut off by a restart is finished by the next scheduled run with the choice it started with (`recoverGame` in `src/workflows/tasks.ts`).
- **Safe to retry.** Every PayPal write (create order, authorize, capture, void, reauthorize) sends a `PayPal-Request-Id`. Settling claims the game row first so a scheduled run and the organizer's button can't both charge.
- **Paying the organizer back.** After settle-up (or a called-off game where the court fee is lost), everything collected goes to the organizer's Venmo or PayPal in one Payout: `payOrganizer` in `src/bot/payout.ts`, `createPayout` in `src/lib/paypal.ts`. The batch id is tied to the game and address, so a retry can't pay twice.
- **Refunds.** A late cancel the organizer charged is offered back when someone takes the spot; one tap refunds the capture: `spotsRefilled` / `refundSpot` in `src/bot/assistant.ts`, `refundCapture` in `src/lib/paypal.ts`.
- **Verified webhooks.** `src/app/api/paypal/webhook/route.ts` checks each event's signature with PayPal and applies it once (`src/lib/webhooks.ts`): expired holds, declined captures, refunds, payout landed / unclaimed / returned.
- **PayPal and Venmo buttons** via the PayPal JS SDK (`fundingSource`), in `src/app/g/[slug]/GameScreen.tsx`.
- **Claude (Haiku 5.5) with forced tool calls.** `parseWithClaude` in `src/bot/parse.ts` (setup messages → structured game). `understand` / `withClaude` in `src/bot/agent.ts` (every other message → one of: join, leave, maybe, waitlist, give spot, invite, answer, private money question, change request, call off, ask organizer, clarify, help, ignore). `withRules` is the fallback.
- **AI never moves money.** `actOn` in `src/bot/assistant.ts` turns a decision into fixed, rule-checked actions.
- **Scheduled work** on Render Workflows: reminders, auto-settle, hold renewal, payout retries and recovery after a restart. A cron job starts the `tick` task every 10 minutes and it fans out one task run per item due (`src/workflows/tasks.ts`, `render.workflows.yaml`).
- **Tested.** `pnpm test` covers money maths, the rule-based fallback, rate limits, retries and the proof table; CI runs typecheck, lint, tests and build on every PR.

## Design

- One link per game, built for a broad-age audience: body text 17px+, 7:1 contrast, 56px buttons, nothing relies on color alone (`src/app/globals.css`).
- Different views from the same link: player, organizer (private token), invite-only, full, late cancel, settled. Desktop gets a wider layout.
- Money details never appear in the group; they go to each person privately.

## Potential impact

- Removes the organizer's two jobs: chasing payment and absorbing no-shows. Players commit with a hold, not a promise.
- Fair, visible rules: free cancel until a deadline, a capped extra if the game runs short, and the organizer decides the hard calls: charge or cover a late cancel, split or cover a short roster, release everyone or charge shares when a game is called off after the court fee is lost.
- Players need no app and no account with us. It works where the group already talks.

## Innovation

- Authorize-then-capture used as a **commitment device** inside a group chat, settled to the real per-player share after the game.
- An agent that lives quietly in a social chat: it ignores small talk, answers game questions, and routes host-only questions privately.

## What's real vs simulated

- **Real:** Claude interpreting messages; the game pages; any hold you place with a PayPal sandbox account (authorize, capture, void, refund against PayPal's sandbox API); the organizer's payout; verified webhooks. `pnpm proof` lists the real sandbox ids from a game.
- **Simulated:** the group chat in `/play` and `/demo` (real iMessage through Blooio and SMS through Sendblue work when their keys are set) and the other players' holds (ids start with `SIM-`, see `src/lib/sim.ts`).

## Known limits

- **Phone numbers aren't verified.** The game page recognises a returning player by the phone number they type. No code is texted to that phone yet, so someone who knows a player's number could drop them out of a game or ask for their refund. Organizer actions are not affected: those need the organizer's private link.
- **Games up to 4 weeks ahead.** A PayPal hold lasts 29 days and can be renewed once, so a game further out is asked for a nearer date. Placing the hold later (approve now, hold a few days before the game) needs PayPal's vault and isn't built.
- **Refunds after the organizer is paid.** Once the payout has gone out, a refund in the app would come from the app's own balance, so the app asks the organizer to pay the player back directly.
- **The demo endpoints are open on purpose.** `/api/demo` and `/api/play` need no sign-in and hand out the simulated players' link tokens, so a judge can switch between them. They only answer for demo groups (`groups.playground`), are rate limited (`src/lib/rate.ts`), and never serve a real group's members or private messages.

## Not built yet

WhatsApp delivery, recurring games with regulars getting first pick, phone number verification, games more than 4 weeks out.

**Built, off by default, not yet run against the PayPal sandbox:** delayed holds (`DELAYED_HOLDS=on`). For a game more than 3 days away the player saves their PayPal at join (PayPal Vault), the scheduled job places the real hold 2 days before the start, and a refused hold gives the player a day to approve again before the spot opens up. See `src/bot/delayed.ts`.
