---
name: tanstack-drizzle
description: Drizzle ORM with PostgreSQL in the tanstack profile — schema conventions (snake_case, uuid keys, timestamps with time zone, money in cents, constraints and indexes), generating and applying migrations, idempotent seed data, queries, joins, transactions and aggregates. Use when changing src/db/schema.ts, migrations, the seed, or writing queries.
user-invocable: false
paths:
  - src/db/**
  - drizzle/**
  - drizzle.config.ts
---

# Drizzle schema, migrations and queries

## Schema (`src/db/schema.ts`)

```ts
import { sql } from 'drizzle-orm'
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const clients = pgTable(
  'clients',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    phone: text().notNull().unique(),
    notes: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('clients_name_idx').on(t.name)],
)

export const visits = pgTable(
  'visits',
  {
    id: uuid().primaryKey().defaultRandom(),
    clientId: uuid().notNull().references(() => clients.id, { onDelete: 'restrict' }),
    visitedAt: timestamp({ withTimezone: true }).notNull(),
    amountCents: integer().notNull(),
  },
  (t) => [index('visits_client_id_idx').on(t.clientId), check('visits_amount_positive', sql`${t.amountCents} >= 0`)],
)
```

- Keys in camelCase; `casing: 'snake_case'` turns them into `visited_at` in the database. Table names: plural snake_case.
- `uuid().primaryKey().defaultRandom()` for ids; `timestamp({ withTimezone: true })` for times; money as `integer` cents; statuses as `text` validated with a Zod enum (add a `check` when the set is fixed).
- Put rules in the database when they must never break: `notNull`, `unique`, foreign keys with a deliberate `onDelete` (`restrict` for business records, `cascade` for owned children), `check`.
- Index every foreign key and every column used for search or sorting.
- Follow the data model in `docs/architecture.md`; if it cannot be implemented as written, report it instead of improvising.

## Migrations

```bash
npm run db:generate -- --name add_clients    # writes drizzle/NNNN_add_clients.sql from the schema diff
npm run db:migrate                          # applies pending migrations
```

- Read the generated SQL before committing. Commit the SQL and `drizzle/meta/` together.
- Never edit or delete a migration that was applied; fix forward with a new one.
- Renames: drizzle-kit asks interactively whether a column was renamed; avoid renames, or write the rename migration explicitly (`npm run db:generate -- --custom --name rename_x`, then SQL `ALTER TABLE … RENAME COLUMN …`).
- Destructive changes (drop, type narrowing) need an ADR first.

## Seed (`src/db/seed.ts`)

Idempotent — safe to run again — and realistic, never real personal data:

```ts
const [client] = await db
  .insert(clients)
  .values({ name: 'Anna Seed', phone: '+7 900 000-00-01' })
  .onConflictDoNothing({ target: clients.phone })
  .returning({ id: clients.id })
if (client) await db.insert(visits).values([{ clientId: client.id, visitedAt: new Date('2026-01-15T10:00:00Z'), amountCents: 150000 }])
```

Accounts for every role the brief names (with passwords from `.env` or obvious test values) so humans and tests can sign in.

## Queries

```ts
import { and, asc, desc, eq, gte, ilike, lt, sql } from 'drizzle-orm'

const [one] = await db.select().from(clients).where(eq(clients.id, id)).limit(1)         // one | undefined
const rows = await db.select({ id: clients.id, name: clients.name }).from(clients).orderBy(asc(clients.name))
const withClient = await db
  .select({ visitId: visits.id, at: visits.visitedAt, client: clients.name })
  .from(visits)
  .innerJoin(clients, eq(visits.clientId, clients.id))
  .where(and(gte(visits.visitedAt, from), lt(visits.visitedAt, to)))
  .orderBy(desc(visits.visitedAt))
const [created] = await db.insert(clients).values(input).returning()
await db.update(clients).set({ notes }).where(eq(clients.id, id))
await db.delete(clients).where(eq(clients.id, id))
```

- `const [row] = …` is `T | undefined` (the project uses `noUncheckedIndexedAccess`): check it.
- Several writes that must succeed together: `await db.transaction(async (tx) => { … tx.insert(…) … })`.
- Races (two people booking the same slot): enforce with a unique index or constraint, and turn the database error into a friendly result:

```ts
try {
  await db.insert(bookings).values(values)
} catch (err) {
  if ((err as { cause?: { code?: string } }).cause?.code === '23505') return { ok: false as const, error: 'This time is no longer available' }
  throw err
}
```

- Never build SQL from strings; raw fragments go through `sql\`…${value}\`` which parameterises values.
- Aggregates (`count`, `sum`, `date_trunc`): see `tanstack-reports`.
