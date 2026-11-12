# Every PayPal call, and why it's made

One page for judges and reviewers: each PayPal API the app calls, the moment in a game that triggers it, the idempotency key it sends, and the file to read. All calls go through `call()` in [`src/lib/paypal.ts`](../src/lib/paypal.ts), which converts integer cents to PayPal's decimal string, sends `PayPal-Request-Id` on every write and retries only timeouts and 5xx with the same id. Everything runs against `api-m.sandbox.paypal.com`.

## The life of one player's money

```
"I'm in"            Orders v2 create (intent AUTHORIZE)  ─┐
PayPal/Venmo popup  buyer approves in PayPal's own window  │  hold for share + cap
                    Orders v2 authorize                  ─┘  nothing charged
drops out early     Payments v2 void                         hold released
game is 3+ days out Payments v2 reauthorize (scheduled)      hold renewed
after the game      Payments v2 capture, partial             real share only, rest released
Late cancel refund  Payments v2 refund                       organizer approves privately
all settled         Payouts v1, Venmo or PayPal              organizer paid back once
any of the above    Webhooks, signature verified             records kept in step
```

## Calls

| Moment | PayPal API | Function | `PayPal-Request-Id` | Called from |
|---|---|---|---|---|
| Player taps **I'm in** | `POST /v2/checkout/orders` with `intent: AUTHORIZE` | `createHoldOrder` | fresh per attempt; the order is bound to game and player server side in `pending_orders` | [`src/app/api/paypal/orders/route.ts`](../src/app/api/paypal/orders/route.ts) |
| Player approves in the PayPal or Venmo window | `POST /v2/checkout/orders/{id}/authorize` | `authorizeOrder` | `authorize-{orderId}` | [`src/app/api/paypal/orders/[id]/authorize/route.ts`](../src/app/api/paypal/orders/%5Bid%5D/authorize/route.ts) |
| Player drops out before free cancel, or a game is called off | `POST /v2/payments/authorizations/{id}/void` | `voidAuthorization` | `void-{authorizationId}` | `src/bot/assistant.ts` |
| A hold passes PayPal's 3-day honor period before the game | `POST /v2/payments/authorizations/{id}/reauthorize` | `reauthorize` | `reauthorize-{authorizationId}` | `reauthorizeHold` in `src/workflows/tasks.ts` (Render Workflows) |
| Settle-up after the game | `POST /v2/payments/authorizations/{id}/capture` with a **partial** amount and `final_capture: true` | `captureAuthorization` | `capture-{authorizationId}` | `settleGame` / `chargeHold` in `src/bot/assistant.ts` |
| Late cancel the organizer chooses to charge | same capture, for the share only | `captureAuthorization` | `capture-{authorizationId}` | `src/bot/assistant.ts` |
| A charged late cancel's spot is filled and the organizer refunds it | `POST /v2/payments/captures/{id}/refund` | `refundCapture` | `refund-{captureId}` | `refundSpot` in `src/bot/assistant.ts` |
| Everything collected goes back to the organizer | `POST /v1/payments/payouts` to a Venmo phone or @handle, or a PayPal email | `createPayout` | the batch id, built from game, address and retry round | `payOrganizer` in [`src/bot/payout.ts`](../src/bot/payout.ts) |
| Every webhook PayPal sends | `POST /v1/notifications/verify-webhook-signature` | `verifyWebhook` | read only | [`src/app/api/paypal/webhook/route.ts`](../src/app/api/paypal/webhook/route.ts) |

**Built, off by default** (`DELAYED_HOLDS=on`): for games more than 3 days away, PayPal Vault saves the player's PayPal at join (`POST /v3/vault/setup-tokens`, then `/v3/vault/payment-tokens`) and the scheduled job places the hold 2 days before the game with a `vault_id` order (`placeVaultedHold`, `saved-hold-{spotId}-…`). See `src/bot/delayed.ts`.

## Webhooks handled

Handled once each (`webhook_events` table), and safe to replay, in [`src/lib/webhooks.ts`](../src/lib/webhooks.ts):

| Event | What changes |
|---|---|
| `PAYMENT.AUTHORIZATION.VOIDED` | A hold that expired or was voided outside the app is marked released |
| `PAYMENT.CAPTURE.COMPLETED` | The charge is confirmed on the player's spot |
| `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.DECLINED` | The charge is undone on our side and the organizer is told privately |
| `PAYMENT.CAPTURE.REFUNDED` | The refund is recorded against the spot |
| `PAYMENT.PAYOUTSBATCH.*`, `PAYMENT.PAYOUTS-ITEM.*` | The organizer's payout moves to sent, unclaimed, returned or failed, and they get a private note |

## Rules the code keeps

- **The server decides every amount.** The browser sends a game and a person; the hold amount comes from the game row. The capture is never more than the hold, which is the share plus the small cap players agreed to for a short game.
- **Claude never moves money.** The model turns a chat message into one of a fixed set of intents (`src/bot/agent.ts`). Only `actOn` in `src/bot/assistant.ts` turns an intent into PayPal calls, with fixed rules.
- **Claim before charge.** Settling updates the game row first, so the scheduled run and the organizer's button can't both capture.
- **Recovers by itself.** A settle, call-off or payout cut off by a restart is finished by the next scheduled run with the choice it started with (`recoverGame` in `src/workflows/tasks.ts`).
- **Money details stay private.** Amounts and payment status go only to the person concerned, never to the group chat.

## Check it yourself

- No keys: open `/play`, run **Play it and settle up**. Holds there are simulated (`SIM-` ids) and never reach PayPal.
- With a PayPal sandbox buyer: open a game page, tap **I'm in**, approve with PayPal or Venmo. That hold is real and shows in the sandbox dashboard.
- After a real run, `pnpm proof` prints the table of real sandbox ids used in the README.
