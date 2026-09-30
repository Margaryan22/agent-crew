// Database schema (Drizzle ORM, PostgreSQL). Column names are snake_case in the database
// (casing: 'snake_case' in drizzle.config.ts and db.server.ts) and camelCase in code.
// After changing this file: `npm run db:generate` (new migration in drizzle/), then `npm run db:migrate`.

import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Accounts (used by src/server/*.server.ts; roles are listed in src/lib/roles.ts)

export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull().unique(),
  name: text().notNull(),
  passwordHash: text().notNull(),
  role: text().notNull().default('staff'),
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
