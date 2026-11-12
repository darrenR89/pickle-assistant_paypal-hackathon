# For AI reviewers

A technical brief of Paddles In for automated and AI-assisted review: what to read, in what order, and the claims each file backs. People should start with the [README](../README.md) or [JUDGES.md](../JUDGES.md).

**Live:** [getpaddlesin.com](https://getpaddlesin.com) · **Phone demo:** [getpaddlesin.com/demo](https://getpaddlesin.com/demo) · **Simulator:** [getpaddlesin.com/play](https://getpaddlesin.com/play) · **Machine-readable summary:** [getpaddlesin.com/llms.txt](https://getpaddlesin.com/llms.txt)

## Read in this order

1. `src/bot/assistant.ts`: every chat action and every money rule (`actOn`, `settleGame`, `chargeHold`, `refundSpot`, `shortfall`).
2. `src/lib/paypal.ts`: the PayPal client (`call()`, idempotency, cents to decimal, retries).
3. `src/bot/agent.ts` and `src/bot/parse.ts`: Claude with forced tool calls, and the rules fallback.
4. `src/workflows/tasks.ts`: scheduled and recovery work on Render Workflows.
5. `src/lib/webhooks.ts` and `src/app/api/paypal/webhook/route.ts`: verified, apply-once webhooks.
6. `src/lib/db.ts`: the schema, created idempotently on first request.

Deeper references: [PAYPAL.md](PAYPAL.md) (every PayPal call), [EDGE-CASES.md](EDGE-CASES.md) (every edge case and how it's handled), [SETUP.md](SETUP.md) (run, deploy, test).


## The system

**Stack.** Next.js 16 (App Router, TypeScript) on a Render web service, Render Postgres, Render Workflows for scheduled tasks, the Anthropic API (`claude-haiku-5-5`), PayPal REST APIs against `api-m.sandbox.paypal.com`, Sendblue for SMS. Schema is created idempotently on first request (`src/lib/db.ts`); all SQL is parameterized through `q`, `one` and `tx`.

**Message pipeline.** A group message enters `src/bot/assistant.ts` from the simulator or Sendblue (polled every 4s, `src/bot/sendblue.ts`). A setup message goes to `parse.ts`, which forces the `create_game` tool to return structured terms (time, place, courts, spots, price, free-cancel time). Every other message goes to `agent.ts`, which forces the `decide` tool to choose one of a fixed set of actions: `ignore`, `join`, `leave`, `maybe`, `waitlist`, `give_spot`, `invite`, `answer`, `private_money`, `change_request`, `call_off`, `ask_organizer`, `clarify`, `help`. Code then checks permissions (only the organizer can change or call off a game), resolves names against real group members, and routes anything about money to a private message. If Claude is unavailable or times out, a keyword rules fallback (`withRules` in `agent.ts`, tested in `rules.test.ts`) returns the same actions.

**The boundary.** The model outputs an action and short reply text, never an amount and never a PayPal call. Only `actOn` in `assistant.ts` turns an action into money movement. The browser sends a game and a person; the server derives every amount from the game row (`holdCents = share_cents + cap_cents`, `src/lib/games.ts`). Amounts are integer cents end to end and converted to PayPal's decimal string only in `src/lib/paypal.ts`.

**Money lifecycle per spot.** `hold_status`: `none → held → captured | voided`, with `reauthorized` set when renewed.

| Step | PayPal API | `PayPal-Request-Id` |
|---|---|---|
| Join | `POST /v2/checkout/orders` (`intent: AUTHORIZE`), order bound to game and person in `pending_orders` | fresh per attempt |
| Approve | `POST /v2/checkout/orders/{id}/authorize` | `authorize-{orderId}` |
| Early drop or call-off | `POST /v2/payments/authorizations/{id}/void` | `void-{authorizationId}` |
| Hold past 3-day honor period | `POST /v2/payments/authorizations/{id}/reauthorize` | `reauthorize-{authorizationId}` |
| Settle or charged late cancel | `POST /v2/payments/authorizations/{id}/capture`, partial, `final_capture: true` | `capture-{authorizationId}` |
| Spot refilled after a charge | `POST /v2/payments/captures/{id}/refund` | `refund-{captureId}` |
| Organizer paid back | `POST /v1/payments/payouts` to a Venmo phone or handle, or PayPal email | batch id from game, address and retry round |
| Every webhook | `POST /v1/notifications/verify-webhook-signature` | read only |

Every request id is derived from the object acted on, so a retry can never charge twice. `call()` retries only timeouts and 5xx, with the same id.

**Invariants the code keeps.**
- Capture is never more than the hold. A short game's gap is split only up to the cap players agreed to, or the organizer covers it (`shortfall` in `src/bot/assistant.ts`, tested in `src/lib/money.test.ts`).
- Claim before charge: settling flips `games.status` from `open` to `settling` in one conditional `UPDATE`, so the scheduled run and the organizer's button can't both capture. Late-cancel decisions use the same pattern on `spots.late_cancel`.
- Webhooks are signature-verified and applied once (`webhook_events`), so replays are safe (`src/lib/webhooks.ts`).
- Money details are sent only by private message, never to the group.

**Scheduling and recovery.** A Render cron runs `pnpm trigger` every 10 minutes to start the `tick` workflow task, which fans out one task run per due item: cancel-by and game-day reminders, auto-settle 3 hours after start, `reauthorizeHold`, payout retries (up to 3), and `recoverGame`, which finishes a settle, call-off or payout interrupted by a restart using the choice it started with (`src/workflows/tasks.ts`, `render.workflows.yaml`). Each task is idempotent.

**Built, off by default.** With `DELAYED_HOLDS=on`, PayPal Vault saves the player's PayPal at join (`/v3/vault/setup-tokens`, `/v3/vault/payment-tokens`) and the hold is placed 2 days before a far-off game (`src/bot/delayed.ts`).

**Verification.** `pnpm typecheck`, `pnpm lint`, `pnpm test` (node:test: money maths, rules fallback, rate limits, clock, retries, Sendblue parsing, proof table) and `pnpm build` run in CI on every PR. `pnpm proof` prints the real-sandbox-id table above from the database, read only, skipping `SIM-` ids (`scripts/proof.ts`).
