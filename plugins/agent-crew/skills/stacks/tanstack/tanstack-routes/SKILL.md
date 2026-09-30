---
name: tanstack-routes
description: TanStack Start routing and server functions in the tanstack profile — file route names, params and search params, loaders, createServerFn with Zod validation and permission checks, calling server functions from pages, invalidating after changes, redirects and not-found, and server routes for downloads or webhooks. Use when adding or changing pages, loaders, server functions or API endpoints.
user-invocable: false
paths:
  - src/routes/**
  - src/server/**
---

# Routes and server functions

## File routes (`src/routes/`)

| File | URL |
|---|---|
| `index.tsx` | `/` |
| `login.tsx` | `/login` |
| `_app.tsx` | pathless layout: children need sign-in |
| `_app/clients/index.tsx` | `/clients` |
| `_app/clients/new.tsx` | `/clients/new` |
| `_app/clients/$clientId.tsx` | `/clients/:clientId` |
| `api/reports/revenue[.]csv.ts` | `/api/reports/revenue.csv` (`[.]` escapes a dot) |

The route id passed to `createFileRoute` must match the file path (`'/_app/clients/$clientId'`); `npm run typecheck` regenerates `src/routeTree.gen.ts` and catches mismatches. Never edit `routeTree.gen.ts`.

## Server functions (`src/server/<area>.ts`)

```ts
import { createServerFn } from '@tanstack/react-start'
import { asc, count, eq, ilike, or } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#/db/db.server'
import { clients } from '#/db/schema'
import { clientInput } from '#/lib/validation/clients'
import { requireUser } from './session.server'

export const listClients = createServerFn({ method: 'GET' })
  .validator(z.object({ q: z.string().trim().max(100).optional(), page: z.number().int().min(1).default(1) }))
  .handler(async ({ data }) => {
    await requireUser()                       // first line: who may call this
    const where = data.q ? or(ilike(clients.name, `%${data.q}%`), ilike(clients.phone, `%${data.q}%`)) : undefined
    const [rows, [total]] = await Promise.all([
      db.select().from(clients).where(where).orderBy(asc(clients.name)).limit(20).offset((data.page - 1) * 20),
      db.select({ value: count() }).from(clients).where(where),
    ])
    return { rows, total: total?.value ?? 0, pageSize: 20 }
  })

export const createClient = createServerFn({ method: 'POST' })
  .validator(clientInput)
  .handler(async ({ data }) => {
    await requireUser('owner', 'staff')
    const [taken] = await db.select({ id: clients.id }).from(clients).where(eq(clients.phone, data.phone)).limit(1)
    if (taken) return { ok: false as const, errors: { phone: 'A client with this phone already exists' } }
    const [row] = await db.insert(clients).values(data).returning({ id: clients.id })
    return { ok: true as const, id: row!.id }
  })
```

- `GET` for reads, `POST` for every change. Use `.validator(schema)` (`.inputValidator` is deprecated).
- Expected business failures (duplicate, slot taken, not allowed now) are **returned** as `{ ok: false, errors | error }` so the form can show them; unexpected problems throw.
- Return plain data (objects, arrays, strings, numbers, `Date`); never return password hashes or other users' private fields.
- Helpers that touch the database from several server functions go to `src/server/<area>.server.ts`.

## Pages that load data

```tsx
import { Link, createFileRoute, notFound, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { getClient, listClients } from '#/server/clients'

export const Route = createFileRoute('/_app/clients/')({
  validateSearch: z.object({ q: z.string().optional(), page: z.number().int().min(1).optional() }),
  loaderDeps: ({ search }) => ({ q: search.q, page: search.page ?? 1 }),
  loader: ({ deps }) => listClients({ data: deps }),
  component: ClientsPage,
})

function ClientsPage() {
  const { rows, total } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  // navigate({ search: { q: 'anna', page: undefined } }) updates the URL and reloads the data
}
```

Route params: `loader: async ({ params }) => { const client = await getClient({ data: { id: params.clientId } }); if (!client) throw notFound(); return client }`.

Context from parents: `Route.useRouteContext()` gives `{ user }` (non-null under `_app`).

## Changing data from a page

```tsx
const router = useRouter()
const result = await createClient({ data: values })
if (result.ok) await router.navigate({ to: '/clients/$clientId', params: { clientId: result.id }, search: { saved: true } })
// after an update on the same page: await router.invalidate() to reload loaders
```

Links: `<Link to="/clients/$clientId" params={{ clientId: c.id }}>`. Keep search params when paging: `<Link from={Route.fullPath} search={(s) => ({ ...s, page: page + 1 })}>`.

## Redirects and guards

- In `beforeLoad`: `throw redirect({ to: '/login', search: { redirect: location.href } })`; for a URL string use `redirect({ href })`.
- Role-only pages: see `tanstack-auth`. The server function must check the role too.

## Server routes (downloads, webhooks)

```ts
export const Route = createFileRoute('/api/reports/revenue.csv')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await currentUser()                      // from #/server/session.server
        if (user?.role !== 'owner') return new Response('Forbidden', { status: 403 })
        return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="revenue.csv"' } })
      },
    },
  },
})
```

Use server routes only for non-JSON responses or external callers; everything the UI needs goes through server functions.
