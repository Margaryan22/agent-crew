// The database client. Server-only: import it from *.server.ts helpers or inside server
// function handlers, never from components.
import 'dotenv/config'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from './schema'

export const db = drizzle(process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/app', {
  schema,
  casing: 'snake_case',
})

export type Db = typeof db
