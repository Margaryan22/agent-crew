// Database schema (Drizzle ORM, PostgreSQL). Column names are snake_case in the database
// (casing: 'snake_case' in drizzle.config.ts and db.server.ts) and camelCase in code.
// After changing this file: `npm run db:generate` (new migration in drizzle/), then `npm run db:migrate`.

import { sql } from 'drizzle-orm'
import { date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Accounts (used by src/server/*.server.ts; roles are listed in src/lib/roles.ts)

export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull().unique(),
  name: text().notNull(),
  passwordHash: text().notNull(),
  role: text().notNull().default('barber'),
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

export const barbers = pgTable('barbers', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull().unique(),
  userId: uuid()
    .unique()
    .references(() => users.id, { onDelete: 'set null' }),
})

export const services = pgTable('services', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull().unique(),
  durationMin: integer().notNull(),
  priceCents: integer().notNull(),
})

export const bookings = pgTable(
  'bookings',
  {
    id: uuid().primaryKey().defaultRandom(),
    barberId: uuid()
      .notNull()
      .references(() => barbers.id, { onDelete: 'restrict' }),
    serviceId: uuid()
      .notNull()
      .references(() => services.id, { onDelete: 'restrict' }),
    // Wall-clock date and start time of the shop (no time zone conversions).
    date: date({ mode: 'string' }).notNull(),
    time: text().notNull(),
    clientName: text().notNull(),
    clientPhone: text().notNull(),
    cancelledAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('bookings_active_slot').on(t.barberId, t.date, t.time).where(sql`${t.cancelledAt} is null`),
    index('bookings_date_idx').on(t.date),
  ],
)
