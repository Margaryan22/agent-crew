// Seed data: the accounts, barbers and services from the interview. Idempotent.
import 'dotenv/config'
import { eq } from 'drizzle-orm'
import { db } from './db.server'
import { barbers, services, users } from './schema'
import { hashPassword } from '../server/password.server'

async function account(email: string, name: string, role: 'owner' | 'barber', password: string) {
  await db.insert(users).values({ email, name, role, passwordHash: await hashPassword(password) }).onConflictDoNothing({ target: users.email })
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email))
  return row!.id
}


async function main() {
  await account('owner@barber.test', 'Owner', 'owner', 'owner-pass-1')
  const ivan = await account('ivan@barber.test', 'Ivan', 'barber', 'ivan-pass-1')
  const sergey = await account('sergey@barber.test', 'Sergey', 'barber', 'sergey-pass-1')
  await db.insert(barbers).values([{ name: 'Ivan', userId: ivan }, { name: 'Sergey', userId: sergey }]).onConflictDoNothing({ target: barbers.name })
  await db
    .insert(services)
    .values([
      { name: 'Haircut', durationMin: 30, priceCents: 2500 },
      { name: 'Beard trim', durationMin: 30, priceCents: 1500 },
    ])
    .onConflictDoNothing({ target: services.name })
  console.log('Seeded accounts, barbers and services')
}

main()
  .then(() => db.$client.end())
  .catch(async (err: unknown) => {
    console.error(err)
    await db.$client.end()
    process.exit(1)
  })
