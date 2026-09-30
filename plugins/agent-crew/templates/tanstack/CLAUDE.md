# Project conventions

TanStack Start (React, file routes, server functions) · Drizzle ORM · PostgreSQL · Tailwind · Vitest · Playwright · TypeScript strict. Built by an Agent Crew; state of the work is in `.crew/`.

## Commands

| Command | What it does |
|---|---|
| `npm run setup` | start PostgreSQL (Docker), apply migrations, seed |
| `npm run dev` | dev server on http://localhost:3000 |
| `npm run typecheck` | regenerate the route tree, then `tsc` |
| `npm run lint` | ESLint |
| `npm test` | unit tests (Vitest, `tests/`) |
| `npm run test:e2e` | end-to-end tests (Playwright, `e2e/`; starts the dev server) |
| `npm run db:generate` | new migration from `src/db/schema.ts` |
| `npm run db:migrate` / `npm run db:seed` | apply migrations / load sample data |
| `npm run build` | production build |

Before handing work over: `npm run typecheck && npm run lint && npm test`, plus the e2e tests of the change.

## Layout

| Path | What lives there |
|---|---|
| `src/routes/` | pages (file-based routes); `_app/` = pages that need sign-in; `api/` = HTTP endpoints |
| `src/components/` | UI components (`ui.tsx`: Button, Field, Alert) |
| `src/server/*.ts` | server functions the UI calls (`createServerFn`) |
| `src/server/*.server.ts` | server-only helpers: sessions, permissions, passwords — never imported by UI code |
| `src/db/schema.ts`, `drizzle/`, `src/db/seed.ts` | schema, migrations, seed data; `db.server.ts` is the client |
| `src/lib/` | code shared by UI and server: roles, validation schemas, formatting, `text.ts` (UI strings) |
| `tests/`, `e2e/` | unit and end-to-end tests |
| `docs/architecture.md`, `docs/ui-contract.md` | data model, roles, modules; UI names the tests rely on |

## Rules

- **Every server function** validates its input with a Zod schema (`.validator(schema)`) and calls `requireUser(...)` (from `#/server/session.server`) first unless the data is public. Hiding a button is not a permission check.
- **Imports** use `#/…` (`import { db } from '#/db/db.server'`). UI files never import `*.server.ts`, `pg` or `node:*`; server functions use those only inside their handlers.
- **Database**: change `src/db/schema.ts`, then `npm run db:generate`; never edit an applied migration. Query through Drizzle — no string-built SQL.
- **UI text** goes through `src/lib/text.ts` (or a module next to it) and is written in the project's language; code and identifiers are English.
- **Accessibility is testability**: every input has a `<label>`, buttons have visible names, messages use `role="alert"` / `role="status"`. Names must match `docs/ui-contract.md`.
- **Secrets** only in `.env` (git-ignored); `.env.example` has placeholders.
- Dates are stored as `timestamp with time zone`; money as integer minor units (cents).
