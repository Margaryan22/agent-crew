// Sessions and permission checks. Server-only: use these inside server function handlers.
import { deleteCookie, getCookie, setCookie, setResponseStatus } from '@tanstack/react-start/server'
import { and, eq, gt } from 'drizzle-orm'
import { db } from '#/db/db.server'
import { sessions, users } from '#/db/schema'
import { isRole } from '#/lib/roles'
import type { CurrentUser, Role } from '#/lib/roles'
import { hashSessionToken, newSessionToken } from './password.server'

const COOKIE = 'sid'
const SESSION_DAYS = 30

/** The signed-in user, or null. */
export async function currentUser(): Promise<CurrentUser | null> {
  const token = getCookie(COOKIE)
  if (!token) return null
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name, role: users.role })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, hashSessionToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1)
  if (!row || !isRole(row.role)) return null
  return { ...row, role: row.role }
}

export class AuthError extends Error {}

/**
 * Call first in every server function that needs a signed-in user. With roles, the user must
 * have one of them. Throws (401/403) otherwise, so no data is read or written.
 */
export async function requireUser(...roles: Array<Role>): Promise<CurrentUser> {
  const user = await currentUser()
  if (!user) {
    setResponseStatus(401)
    throw new AuthError('Sign in to continue')
  }
  if (roles.length && !roles.includes(user.role)) {
    setResponseStatus(403)
    throw new AuthError('You do not have access to this')
  }
  return user
}

export async function startSession(userId: string): Promise<void> {
  const token = newSessionToken()
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  await db.insert(sessions).values({ id: hashSessionToken(token), userId, expiresAt })
  setCookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  })
}

export async function endSession(): Promise<void> {
  const token = getCookie(COOKIE)
  if (token) await db.delete(sessions).where(eq(sessions.id, hashSessionToken(token)))
  deleteCookie(COOKIE, { path: '/' })
}
