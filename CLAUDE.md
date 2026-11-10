# CLAUDE.md

Rules for AI agents working in this repo. The full standard is [CONTRIBUTING.md](CONTRIBUTING.md); read it before your first change. This file lists what agents get wrong most often.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm typecheck   # must pass before every push
pnpm lint        # must pass before every push; add no new warnings
pnpm test        # unit tests (node:test via tsx), must pass
pnpm build       # must pass before every push
pnpm dev         # http://localhost:3000/play
```

## Always

- Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` before pushing, and say in the PR that you did.
- Check open PRs first and don't edit files another open PR is changing.
- Keep each PR to one concern and under about 400 changed lines of code. Fill in `.github/pull_request_template.md`.
- Commit messages: `Area: what changed, in plain words` (see `git log`).
- Add a `*.test.ts` next to any money, parsing or rules logic you change.
- Keep amounts in integer cents. The server decides every amount.
- Send a `PayPal-Request-Id` derived from the object acted on with every PayPal POST (see `src/lib/paypal.ts`).
- Use parameterized SQL (`q`, `one`, `tx` from `@/lib/db`). Schema changes are additive and idempotent.
- Screenshot UI changes at 390px and 1440px wide and attach them to the PR.
- Document new env vars in `.env.example` and the Render blueprint.

## Ask Darren first

- Adding a dependency
- A refactor that moves or renames files across folders
- Anything that changes how money is held, captured, refunded or paid out
- Switching `PAYPAL_ENV` away from `sandbox`, or changing Render plans or services

## Never

- Use `any`, `@ts-ignore`, or `as never` to get past a type error
- Let Claude's output choose an amount or trigger a PayPal call directly
- Post money details to the group chat (private messages only)
- Import `lib/db`, `lib/paypal` or `bot/` from a `"use client"` file, or put a secret in `NEXT_PUBLIC_*`
- Commit `.env`, keys or tokens
- Force-push a shared branch or push to `main`
