// Seed data for development and tests: `npm run db:seed`. Idempotent — safe to run again.
// Add the project's sample data at the end (realistic, never real personal data).
import 'dotenv/config'
import { db } from './db.server'
import { users } from './schema'
import { hashPassword } from '../server/password.server'

async function seedOwner() {
  const email = (process.env.SEED_OWNER_EMAIL ?? 'owner@example.com').toLowerCase()
  const password = process.env.SEED_OWNER_PASSWORD ?? 'owner-password'
  const name = process.env.SEED_OWNER_NAME ?? 'Owner'
  const inserted = await db
    .insert(users)
    .values({ email, name, role: 'owner', passwordHash: await hashPassword(password) })
    .onConflictDoNothing({ target: users.email })
    .returning({ id: users.id })
  console.log(inserted.length ? `Created owner ${email}` : `Owner ${email} already exists`)
}

async function main() {
  await seedOwner()
  // Project sample data goes here.
}

main()
  .then(() => db.$client.end())
  .catch(async (err: unknown) => {
    console.error(err)
    await db.$client.end()
    process.exit(1)
  })
