# Pickleball assistant (working name)

A pickleball assistant that lives in your group chat. Saying you're in and approving a PayPal or Venmo hold for your share are one tap, so the organizer never fronts the court cost. After the game, holds settle automatically.

Entry for the PayPal AI Hackathon. Work in progress.

## Run it locally

Requires Node 22+ and pnpm (`corepack enable`).

```bash
cp .env.example .env      # then fill in your PayPal sandbox keys
pnpm install
pnpm dev                  # http://localhost:3000/g/thu-6pm
```

Approve the hold with a PayPal sandbox personal account (developer.paypal.com > Sandbox Accounts).

To receive PayPal webhooks while developing, expose your machine with a quick tunnel:

```bash
cloudflared tunnel --url http://localhost:3000
```

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
