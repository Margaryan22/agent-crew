// Database schema (Drizzle ORM, PostgreSQL). Column names are snake_case in the database
// (casing: 'snake_case' in drizzle.config.ts and db.server.ts) and camelCase in code.
// After changing this file: `npm run db:generate` (new migration in drizzle/), then `npm run db:migrate`.

import { sql } from 'drizzle-orm'
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Accounts (used by src/server/*.server.ts; roles are listed in src/lib/roles.ts)

export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull().unique(),
  name: text().notNull(),
  passwordHash: text().notNull(),
  role: text().notNull().default('keeper'),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

export const sessions = pgTable(
  'sessions',
  {
    // SHA-256 of the session token; the token itself lives only in the user's cookie.
    id: text().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
)

// ---------------------------------------------------------------------------
// Business data — add the project's tables below (see docs/architecture.md).

export const products = pgTable('products', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  sku: text().notNull().unique(),
  unit: text().notNull(),
  minStock: integer().notNull().default(0),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

export const movements = pgTable(
  'movements',
  {
    id: uuid().primaryKey().defaultRandom(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    kind: text().notNull(),
    quantity: integer().notNull(),
    note: text(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('movements_product_idx').on(t.productId),
    index('movements_created_idx').on(t.createdAt),
    check('movements_kind', sql`${t.kind} in ('receipt', 'shipment')`),
    check('movements_quantity_positive', sql`${t.quantity} > 0`),
  ],
)
