---
name: tanstack-stack
description: Entry point of the tanstack stack profile (TanStack Start, Drizzle, PostgreSQL, Tailwind, Vitest, Playwright) — project setup from the template, commands, folder layout and who owns what, core conventions, and which stack skill to load for routes, database, auth, forms, tables, reports and tests. Load before writing or reviewing code in a tanstack crew project.
user-invocable: false
---

# Stack profile: tanstack

TanStack Start (React 19, file-based routes, server functions, SSR) · Drizzle ORM 0.45 on PostgreSQL 17 · Tailwind 4 · Zod 4 · Vitest 5 · Playwright · TypeScript 6 strict. The project's `CLAUDE.md` has the short version of these rules; this skill has the details.

## Setup (orchestrator, new project)

```bash
crew scaffold                       # copies the template, never overwrites; creates .env from .env.example
npm install
npm run setup                       # PostgreSQL in Docker (waits until healthy), migrations, seed
npx playwright install chromium     # browsers for e2e, once per machine
npm run typecheck && npm run lint && npm test && npm run test:e2e
git init -q 2>/dev/null; git add -A && git commit -m "chore: scaffold from agent-crew template"
```

- The template already has: sign-in/sign-out with sessions, roles `owner`/`staff`, a seeded owner (from `.env`), a protected dashboard, UI building blocks, 4 passing e2e tests.
- Port 5432 busy: set `DB_PORT=5433` in `.env` and change the port in `DATABASE_URL`, then `npm run setup` again.
- Docker missing or not running: `crew escalate --kind access --question "Docker is needed for the local database — can you start it?" …`; meanwhile keep working on tasks that do not need the database.
- `npm install` warns that install scripts were skipped (esbuild): harmless.

## Commands

| Command | Use |
|---|---|
| `npm run dev` | dev server, http://localhost:3000 (e2e tests start it themselves) |
| `npm run typecheck` | regenerates `src/routeTree.gen.ts`, then `tsc` — run after adding or renaming routes |
| `npm run lint` · `npm test` · `npm run test:e2e` | ESLint · Vitest (`tests/`) · Playwright (`e2e/`) |
| `npx playwright test e2e/clients.spec.ts -g "AC-03"` | one e2e file or test |
| `npm run db:generate` → `npm run db:migrate` | schema change → migration → apply |
| `npm run db:seed` | idempotent sample data |
| `npm run build` · `npm run preview` | production build · serve it on port 3000 |
| `npm audit --omit=dev --audit-level=high` | dependency scanner for the security review |

## Layout and owners

| Path | Owner | Notes |
|---|---|---|
| `src/routes/**` (pages), `src/components/**`, `src/styles.css`, `src/lib/text.ts`, `public/` | frontend | `_app/` = needs sign-in |
| `src/server/*.ts` (server functions), `src/server/*.server.ts`, `src/routes/api/**`, `src/lib/**` | backend | `src/lib/validation/` holds Zod schemas shared with forms |
| `src/db/**`, `drizzle/**`, `drizzle.config.ts` | db | `db.server.ts` is the client, `seed.ts` the sample data |
| `tests/**`, `e2e/**`, `playwright.config.ts`, `vitest.config.ts` | qa | |
| `package.json`, configs, `docker-compose.yml`, `.env.example`, `CLAUDE.md`, `README.md` | architect | |

## Core conventions

1. Pages call **server functions** (`src/server/<area>.ts`) for all data; server functions validate input with Zod (`.validator(schema)`) and call `requireUser(...)` first. → `tanstack-routes`, `tanstack-auth`
2. Server-only code (database, cookies, `node:*`, secrets) lives in `*.server.ts` and is imported only by server functions and server routes. TanStack Start blocks `*.server.*` imports in browser code.
3. Imports use `#/…` (`#/db/db.server`, `#/lib/roles`).
4. Database names are snake_case, code camelCase (`casing: 'snake_case'`); money in integer cents; times `timestamp with time zone`. → `tanstack-drizzle`
5. Every input has a label, every message a role; names follow `docs/ui-contract.md`. → `tanstack-forms`, `tanstack-e2e`
6. User-facing strings in the project language, in `src/lib/text.ts` or next to the feature; the first frontend task translates the template's strings and sets `text.lang`.

## Which skill to load

| You are working on | Load |
|---|---|
| a page, route params, search params, loaders, server functions, API endpoints | `tanstack-routes` |
| tables, migrations, seed data, queries, transactions | `tanstack-drizzle` |
| sign-in, roles, permissions, staff accounts | `tanstack-auth` |
| a form, validation, error messages | `tanstack-forms` |
| a list page with search, sorting, pages; create/edit/delete screens | `tanstack-tables` |
| totals, charts-free reports, CSV export | `tanstack-reports` |
| e2e or unit tests | `tanstack-e2e` |

Versions are pinned by `package-lock.json`. Add packages only from the stack allowlist (hooks enforce it); `npm install` with no arguments is always fine.
