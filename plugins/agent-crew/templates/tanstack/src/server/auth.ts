// Sign-in, sign-out and the current user, as server functions the UI can call.
import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#/db/db.server'
import { users } from '#/db/schema'
import { verifyAgainstDummy, verifyPassword } from './password.server'
import { currentUser, endSession, startSession } from './session.server'

export const getCurrentUser = createServerFn({ method: 'GET' }).handler(() => currentUser())

const signInInput = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
})

export const signIn = createServerFn({ method: 'POST' })
  .validator(signInInput)
  .handler(async ({ data }) => {
    const [user] = await db.select().from(users).where(eq(users.email, data.email)).limit(1)
    const ok = user ? await verifyPassword(data.password, user.passwordHash) : await verifyAgainstDummy(data.password)
    if (!user || !ok) return { ok: false as const }
    await startSession(user.id)
    return { ok: true as const }
  })

export const signOut = createServerFn({ method: 'POST' }).handler(async () => {
  await endSession()
  return { ok: true as const }
})
