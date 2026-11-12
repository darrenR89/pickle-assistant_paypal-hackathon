# Every case, and how it's handled

This page covers what happens when a game doesn't go to plan. Each row names the rule and the code that keeps it. Every amount is decided by the server in integer cents, and Claude never moves money (see [PAYPAL.md](PAYPAL.md)). All money goes to the person it concerns in a private message, never to the group.

## Joining

| Case | What happens | Code |
|---|---|---|
| "yeah I'm down", "in 🙌" | Counted as in. The player gets the game link so they can hold their spot. | `understand` in `src/bot/agent.ts`; rules fallback `withRules` |
| Game is full | The player can join the waitlist. When a spot opens, they're sent the link. | `tagWaitlist`, `spotOfferFor` in `src/bot/assistant.ts` |
| The last spot fills while someone is in the PayPal window | No hold is placed and the player is told the game is full. The game can't be overbooked. | `src/app/api/paypal/orders/[id]/authorize/route.ts` |
| Game is invite-only and a stranger says "in" | The group hears nothing. The organizer is asked privately to let them in or not. | `requestInvite`, `grantInvite`, `declineInvite` |
| "Give my spot to Lee" | The spot moves to Lee, who places their own hold. | `give_spot` in `src/bot/agent.ts` |
| A vague setup message ("game Thursday?") | A draft starts, and the organizer finishes it privately before the link goes out. | `src/bot/parse.ts` |
| Silly numbers (0 spots, $1M court, a time in the past) | Spots stay 2 to 32, the court is capped at $10,000 and the extra at $100. A past time moves to next week. | `src/lib/limits.ts` |

## Dropping out

| Case | What happens | Code |
|---|---|---|
| Drops out before free cancel ends | The hold is voided. They pay nothing. | `playerOut` → `voidAuthorization` |
| Drops out late | The organizer chooses privately: **charge** the share, **cover** it, or **wait** for a replacement. | `resolveLateCancel`, `waitForReplacement` |
| A late canceller's spot gets filled | They owe nothing. An undecided hold is released, and a charge the organizer already took is offered back as a refund. | `spotsRefilled`, `refundSpot` → `refundCapture` |
| A refund is asked for after the organizer was paid out | The app doesn't refund from its own balance. It asks the organizer to pay the player back directly. | `requestRefund` |

## Settling up

| Case | What happens | Code |
|---|---|---|
| Full game | Each player is charged their share, and the rest of each hold is released. | `settleGame` → `captureAuthorization` (partial) |
| Short game (fewer played than booked) | The organizer chooses privately to split the gap (capped at the extra each player agreed to) or cover it. Each share is rounded down, and the leftover cents stay with the organizer. | `shortfall`, `settleClaimed` |
| A late cancel was charged | Their charge counts toward the court, so the players left are never charged extra for that spot. | `chargedLateCancels`, `shortfall`; tests in `src/lib/money.test.ts` |
| A hold PayPal can't charge (expired, declined) | That one hold is skipped and the organizer is told. Everyone else still settles. | `chargeHold` |
| The scheduled run and the organizer's button both settle | The game row is claimed first, so only one of them captures. | `settleGame` |
| The server restarts mid-settle | The next scheduled run finishes it, with the choice it started with. | `recoverGame` in `src/workflows/tasks.ts` |
| A PayPal call is retried | The same `PayPal-Request-Id` is sent, so PayPal never charges twice. | `call()` in `src/lib/paypal.ts` |

## The game falls apart

| Case | What happens | Code |
|---|---|---|
| Called off with time to spare | Every hold is voided. | `cancelGame` |
| Called off after the court fee is lost | The organizer chooses privately: release everyone, or charge each player their share. | `cancelGame` |

## Holds over time

| Case | What happens | Code |
|---|---|---|
| A hold is more than 3 days old before the game | It's reauthorized on schedule, so it's good on game day. | `reauthorizeHold` in `src/workflows/tasks.ts` |
| A game more than 4 weeks out | The organizer is asked for a nearer date, because a PayPal hold lasts 29 days and renews once. | `src/lib/limits.ts` |
| A hold expires or is voided outside the app | The verified webhook marks it released. | `src/lib/webhooks.ts` |

## Paying the organizer back

| Case | What happens | Code |
|---|---|---|
| Everything is settled | Everything collected goes to the organizer's Venmo or PayPal in one payout. | `payOrganizer` in `src/bot/payout.ts` |
| A payout fails or is unclaimed | The webhook updates it, the organizer is told, and a retry goes out under a new batch id tied to the game. It can never pay twice. | `retryPayout`, `src/lib/webhooks.ts` |

## Known limits

These are listed in [JUDGES.md](../JUDGES.md#known-limits): phone numbers aren't verified yet, delayed holds are built but off by default, and the demo endpoints are open on purpose but rate limited.
