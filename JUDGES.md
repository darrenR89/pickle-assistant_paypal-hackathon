# For judges

A short map from each judging criterion to what you can try and the code behind it. Everything runs in the PayPal sandbox; no real money moves.

**Fastest way to see it:** open https://pickle-assistant.onrender.com/demo on a computer and scan the code with your phone (or open it on your phone and use **Demo steps**). You organize a game; the page plays the rest of the group. About two minutes.

## Technological implementation

- **PayPal Orders v2 with intent AUTHORIZE.** Joining creates an order for the share plus a cap, then authorizes it: `createHoldOrder`, `authorizeOrder` in `src/lib/paypal.ts`; routes `src/app/api/paypal/orders/route.ts` and `src/app/api/paypal/orders/[id]/authorize/route.ts`.
- **Release, renew, charge.** `voidAuthorization` (free cancel), `reauthorize` (after PayPal's 3-day honor period, scheduled in `src/workflows/tasks.ts`), `captureAuthorization` with a partial amount at settle-up: `settleGame` / `settleClaimed` in `src/bot/assistant.ts`.
- **Safe to retry.** Every PayPal write (create order, authorize, capture, void, reauthorize) sends a `PayPal-Request-Id`. Settling claims the game row first so a scheduled run and the organizer's button can't both charge.
- **PayPal and Venmo buttons** via the PayPal JS SDK (`fundingSource`), in `src/app/g/[slug]/GameScreen.tsx`.
- **Claude (Haiku 5.5) with forced tool calls.** `parseWithClaude` in `src/bot/parse.ts` (setup messages → structured game). `understand` / `withClaude` in `src/bot/agent.ts` (every other message → one of: join, leave, maybe, waitlist, give spot, invite, answer, private money question, change request, call off, ask organizer, clarify, help, ignore). `withRules` is the fallback.
- **AI never moves money.** `actOn` in `src/bot/assistant.ts` turns a decision into fixed, rule-checked actions.
- **Scheduled work** on Render Workflows: reminders, auto-settle, hold renewal (`src/workflows/tasks.ts`).

## Design

- One link per game, built for a broad-age audience: body text 17px+, 7:1 contrast, 56px buttons, nothing relies on color alone (`src/app/globals.css`).
- Different views from the same link: player, organizer (private token), invite-only, full, late cancel, settled. Desktop gets a wider layout.
- Money details never appear in the group; they go to each person privately.

## Potential impact

- Removes the organizer's two jobs: chasing payment and absorbing no-shows. Players commit with a hold, not a promise.
- Fair, visible rules: free cancel until a deadline, a capped extra if the game runs short, and the organizer decides late cancels.
- Players need no app and no account with us. It works where the group already talks.

## Innovation

- Authorize-then-capture used as a **commitment device** inside a group chat, settled to the real per-player share after the game.
- An agent that lives quietly in a social chat: it ignores small talk, answers game questions, and routes host-only questions privately.

## What's real vs simulated

- **Real:** Claude interpreting messages; the game pages; any hold you place with a PayPal sandbox account (authorize, capture, void against PayPal's sandbox API).
- **Simulated:** the group chat itself (real iMessage delivery is next) and the other players' holds (ids start with `SIM-`, see `src/lib/sim.ts`).

## Not built yet

Payouts to the organizer, real iMessage/WhatsApp delivery, recurring games with regulars getting first pick.
