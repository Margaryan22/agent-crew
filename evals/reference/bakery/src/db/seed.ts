// Seed data: the accounts and the menu from the interview. Idempotent.
import 'dotenv/config'
import { db } from './db.server'
import { products, users } from './schema'
import { hashPassword } from '../server/password.server'

async function main() {
  await db
    .insert(users)
    .values([
      { email: 'owner@bakery.test', name: 'Owner', role: 'owner', passwordHash: await hashPassword('owner-pass-1') },
      { email: 'baker@bakery.test', name: 'Baker', role: 'baker', passwordHash: await hashPassword('baker-pass-1') },
    ])
    .onConflictDoNothing({ target: users.email })
  await db
    .insert(products)
    .values([
      { name: 'Sourdough loaf', priceCents: 600 },
      { name: 'Croissant', priceCents: 250 },
      { name: 'Birthday cake', priceCents: 3000 },
    ])
    .onConflictDoNothing({ target: products.name })
  console.log('Seeded accounts and products')
}

main()
  .then(() => db.$client.end())
  .catch(async (err: unknown) => {
    console.error(err)
    await db.$client.end()
    process.exit(1)
  })
