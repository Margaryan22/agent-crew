---
name: tanstack-auth
description: The tanstack template's built-in authentication and roles — users and sessions tables, scrypt passwords, the session cookie, requireUser() in server functions, sign-in-only and role-only pages, staff accounts created by the owner, seeded accounts. Use when a task touches sign-in, roles, permissions or user accounts.
user-invocable: false
paths:
  - src/server/session.server.ts
  - src/server/auth.ts
  - src/server/users.ts
  - src/lib/roles.ts
  - src/routes/login.tsx
  - src/routes/_app.tsx
---

# Authentication and roles

The template ships complete email + password authentication. **Do not add an auth library** (better-auth, next-auth, passport…): extend what is there.

| Piece | Where |
|---|---|
| `users` (email, name, `passwordHash`, `role`), `sessions` (hashed token, expiry) | `src/db/schema.ts` |
| scrypt hashing, session tokens | `src/server/password.server.ts` |
| `currentUser()`, `requireUser(...roles)`, `startSession()`, `endSession()` | `src/server/session.server.ts` |
| server functions `getCurrentUser`, `signIn`, `signOut` | `src/server/auth.ts` |
| roles list, `hasRole()`, `CurrentUser` type | `src/lib/roles.ts` |
| sign-in page; pages that need sign-in | `src/routes/login.tsx`; `src/routes/_app.tsx` + `src/routes/_app/**` |

Sessions last 30 days in an httpOnly, SameSite=Lax cookie (`secure` in production); the database stores only a SHA-256 of the token, so a leaked database does not leak sessions.

## Roles

The architect names the roles in `docs/architecture.md`. Implement them in one place:

```ts
// src/lib/roles.ts
export const ROLES = ['owner', 'barber', 'staff'] as const
```

Then seed an account per role (`src/db/seed.ts`), and use the names everywhere below. The `role` column is `text`; `isRole()` rejects unknown values when a session is read.

## Permission checks — on the server, every time

```ts
export const deleteClient = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireUser('owner')      // 401 when signed out, 403 for other roles
    // … use user.id for ownership checks: where(and(eq(t.id, data.id), eq(t.ownerId, user.id)))
  })
```

- `requireUser()` with no roles = any signed-in user. Call it before reading or writing anything.
- Records that belong to someone (a barber's own appointments) need an ownership condition in the query, not only a role.
- Public data (a booking page for clients without accounts) skips `requireUser()` — say so in a comment and return only what the public may see.

## Pages

- Under `src/routes/_app/` a page already requires sign-in; `Route.useRouteContext().user` is the current user.
- Role-only page — hide it from other roles; the server function still checks:

```tsx
export const Route = createFileRoute('/_app/reports/revenue')({
  beforeLoad: ({ context }) => {
    if (!hasRole(context.user, 'owner')) throw redirect({ to: '/dashboard' })
  },
  // …
})
```

- Role-only controls: `{hasRole(user, 'owner') ? <Button …>Delete client</Button> : null}`.
- Navigation links for role-only pages are shown only to those roles (in `__root.tsx`).

## Staff accounts (owner creates them)

```ts
export const createUser = createServerFn({ method: 'POST' })
  .validator(z.object({
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(8, 'At least 8 characters').max(200),
    role: z.enum(ROLES),
  }))
  .handler(async ({ data }) => {
    await requireUser('owner')
    const inserted = await db
      .insert(users)
      .values({ name: data.name, email: data.email, role: data.role, passwordHash: await hashPassword(data.password) })
      .onConflictDoNothing({ target: users.email })
      .returning({ id: users.id })
    return inserted[0] ? { ok: true as const, id: inserted[0].id } : { ok: false as const, errors: { email: 'This email is already in use' } }
  })
```

Never return `passwordHash` from a server function; select the columns you need.

## Seeded accounts and tests

`npm run db:seed` creates the owner from `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD` / `SEED_OWNER_NAME` in `.env`. When the brief or interview names accounts for testing, seed exactly those. E2E tests sign in through the UI (`signIn(page, user)` in `e2e/helpers.ts`).

## Not in v1 unless the brief asks

Password reset by email, sign-up by visitors, two-factor, OAuth. If the brief needs one, the architect writes an ADR first.
