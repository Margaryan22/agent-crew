import { describe, expect, it } from 'vitest'
import { hashPassword, hashSessionToken, newSessionToken, verifyPassword } from '#/server/password.server'
import { safeRedirect } from '#/lib/redirect'
import { hasRole } from '#/lib/roles'

describe('passwords', () => {
  it('verifies the right password and rejects others', async () => {
    const hash = await hashPassword('correct horse')
    expect(hash).toMatch(/^scrypt\$/)
    expect(await verifyPassword('correct horse', hash)).toBe(true)
    expect(await verifyPassword('wrong horse', hash)).toBe(false)
    expect(await verifyPassword('correct horse', 'garbage')).toBe(false)
  })

  it('salts every hash', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'))
  })
})

describe('sessions', () => {
  it('stores only a hash of the token', () => {
    const token = newSessionToken()
    expect(token.length).toBeGreaterThanOrEqual(43)
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashSessionToken(token)).not.toContain(token)
  })
})

describe('helpers', () => {
  it('keeps redirects on this site', () => {
    expect(safeRedirect('/bookings?day=1')).toBe('/bookings?day=1')
    expect(safeRedirect('https://evil.example')).toBe('/dashboard')
    expect(safeRedirect('//evil.example')).toBe('/dashboard')
    expect(safeRedirect(undefined)).toBe('/dashboard')
  })

  it('checks roles', () => {
    expect(hasRole({ role: 'owner' }, 'owner')).toBe(true)
    expect(hasRole({ role: 'staff' }, 'owner')).toBe(false)
    expect(hasRole(null, 'owner')).toBe(false)
  })
})
