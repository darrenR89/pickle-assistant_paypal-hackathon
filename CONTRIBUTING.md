# Contributing

How we build this repo. Every pull request, from a person or an AI agent, follows it. If a rule here gets in the way, change the rule in its own PR instead of quietly breaking it.

The short version: **small PRs, green checks, money logic you can trust, and a description a reviewer can read in two minutes.**

## Setup and commands

Node 22+ and pnpm (`corepack enable`). Copy `.env.example` to `.env` and fill in sandbox keys.

| Task | Command |
|---|---|
| Install | `pnpm install --frozen-lockfile` |
| Dev server | `pnpm dev` (then open `/play` or `/demo`) |
| Type check | `pnpm typecheck` |
| Production build | `pnpm build` |
| Run the scheduled tick once | `pnpm tick:local` |

`pnpm typecheck` and `pnpm build` must pass before you open or update a PR. CI runs both on every PR.

## Where code goes

| Folder | What lives there | Rule |
|---|---|---|
| `src/app/**/page.tsx`, `layout.tsx` | Routes. Server components by default. | Fetch data here and pass it down. |
| `src/app/**/*.tsx` (client) | Interactive pieces (`"use client"`). | Keep the client boundary as low in the tree as you can. |
| `src/app/api/**/route.ts` | HTTP handlers. | Thin: parse and check input, call `lib`/`bot`, return JSON. No business rules. |
| `src/lib/` | Database (`db.ts`), PayPal client (`paypal.ts`), game records, webhooks, shared helpers. | No React. Server only. |
| `src/bot/` | The assistant: Claude calls, rule fallback, and the actions that follow a decision. | The model decides what people mean; code decides what happens to money. |
| `src/workflows/` | Timed jobs on Render Workflows (reminders, settle, renew holds). | Must be safe to run twice. |
| `public/` | Static files. Screenshots are `.webp`. | Keep images small; compress before committing. |

Import with the `@/` alias (`@/lib/db`), not long relative paths.

## Code style

- **TypeScript strict, no escape hatches.** No `any`, no `@ts-ignore`, no `as never` to silence an error. Narrow `unknown` instead. Use `import type` for types.
- **Small functions, early returns.** Handle the error or empty case first and return.
- **Files stay readable.** Aim for under about 400 lines. When a file you are already changing passes that, split out a piece in a separate PR first.
- **Names say what a thing is in the product's words:** game, spot, hold, share, cap, organizer, payout.
- **Comments explain why, not what.** A comment that repeats the code gets deleted. A comment that records a PayPal quirk or a product rule stays.
- **Server-only code stays on the server.** Never import `lib/db`, `lib/paypal` or `bot/` from a client component. Never put a secret in a `NEXT_PUBLIC_` variable.
- **Environment variables** are read in one place per concern and documented in `.env.example`. A new variable also goes in `render.yaml` (or `render.workflows.yaml`) with `sync: false` if it is a secret.
- **Next.js 16 conventions:** `params` and `searchParams` are Promises, so await them. Use the Metadata API, not hand-written `<head>` tags.
- **Dependencies:** ask before adding one. Prefer the platform (fetch, `crypto.randomUUID`, `Intl`) and what we already have. Commit the updated `pnpm-lock.yaml`.

## Money and PayPal

These rules protect real money once we leave the sandbox. A PR that breaks one is not merged.

1. **Amounts are integer cents** everywhere in our code. Convert to PayPal's decimal string only inside `lib/paypal.ts`.
2. **The server decides every amount.** Never take an amount, a game, or a person from the request body without looking it up and checking it.
3. **Every PayPal write sends a `PayPal-Request-Id`** built from the thing it acts on (`capture-${authorizationId}`), so a retry returns the first result instead of charging twice. Retry only on timeouts and 5xx, with the same id.
4. **Webhooks are verified, recorded once, and safe to replay.** Verify the signature with PayPal before reading the event, store its id, and make the handler idempotent. Return 2xx only when the event is handled.
5. **Money moves only in deterministic code** in `src/bot/assistant.ts`, `src/bot/payout.ts` and `src/workflows/`. Claude's output can pick an action, never an amount.
6. **Claim before you charge.** When two paths could settle the same game (the scheduled run and the organizer's button), update the row first and only the winner calls PayPal.
7. **Money details go only to the person concerned**, privately. Never post amounts or payment status to the group.
8. **Sandbox only** (`PAYPAL_ENV=sandbox`) until we decide otherwise.

## Database

- **Parameterized queries only** (`q("... where id = $1", [id])`). Never build SQL from user input. A column name in SQL must come from a typed union, as in `spotBy` in `src/lib/webhooks.ts`.
- **Schema changes are additive and idempotent** in `src/lib/db.ts`: `create table if not exists`, `alter table ... add column if not exists`. Never drop or rename a column the deployed app still reads.
- **Several writes that must happen together go in `tx()`.**

## AI (Claude)

- Model ids live in one constant per file and use the current Haiku id. Use forced tool calls with a typed schema, not free text.
- Every Claude path has a rule-based fallback that works with no `ANTHROPIC_API_KEY`.
- Never send secrets, tokens, or payment details to the model.

## UI and accessibility

- Semantic HTML first: one `<main>`, real `<button>` and `<a>`, labelled sections, `alt` on every image.
- Everything works with a keyboard and shows a visible focus ring.
- Motion respects `prefers-reduced-motion`; anything that moves on its own has a pause.
- Text contrast meets WCAG AA (4.5:1 for body text).
- Styles live in `src/app/globals.css` under a prefix per area (`lp-` landing, `dp-` phone demo, `dr-` demo remote, `sim-` playground). New areas pick a new prefix.
- Check every UI change at phone width (390px) and desktop (1440px).

## Branches, commits and pull requests

- **Branch** from `main`: `feature/short-name`, `fix/short-name`, or the branch an agent session was given.
- **Commit messages:** `Area: what changed, in plain words`, matching the history (`Landing page: facts as an open list`, `Demo page: let the header copy run full width`). One idea per commit.
- **One concern per PR.** A feature, a fix, or a refactor, not two. Keep it under about 400 changed lines of code (lockfile, images and docs don't count). Split bigger work into a stack of PRs that each keep the app working.
- **Don't edit files another open PR is changing** unless you coordinate first. Check open PRs before you start.
- **Fill in the PR template:** what and why, how you tested, screenshots for UI changes (phone and desktop), and any risk to money flows.
- **Never force-push a shared branch** or rewrite `main`. Never commit `.env` or a key.
- **Darren reviews and merges.** A PR merges when checks are green and the template is complete.

## Definition of done

- [ ] `pnpm typecheck` and `pnpm build` pass locally and in CI
- [ ] The change was tried in the running app (`/play`, `/demo`, or the page it touches)
- [ ] Money rules above still hold; any PayPal call change was tried in the sandbox
- [ ] New env vars are in `.env.example` and the Render blueprint
- [ ] README or JUDGES.md updated if behaviour a judge or user sees has changed
- [ ] PR is small, has one concern, and the template is filled in
