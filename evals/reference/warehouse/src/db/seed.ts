// Seed data: the two accounts from the interview. Idempotent.
import 'dotenv/config'
import { db } from './db.server'
import { users } from './schema'
import { hashPassword } from '../server/password.server'

async function main() {
  await db
    .insert(users)
    .values([
      { email: 'owner@stock.test', name: 'Owner', role: 'owner', passwordHash: await hashPassword('owner-pass-1') },
      { email: 'keeper@stock.test', name: 'Storekeeper', role: 'keeper', passwordHash: await hashPassword('keeper-pass-1') },
    ])
    .onConflictDoNothing({ target: users.email })
  console.log('Seeded accounts')
}

main()
  .then(() => db.$client.end())
  .catch(async (err: unknown) => {
    console.error(err)
    await db.$client.end()
    process.exit(1)
  })
