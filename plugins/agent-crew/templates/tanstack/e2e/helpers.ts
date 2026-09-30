import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { text } from '../src/lib/text'

export { text }

/** The account `npm run db:seed` creates (see .env). */
export const owner = {
  email: process.env.SEED_OWNER_EMAIL ?? 'owner@example.com',
  password: process.env.SEED_OWNER_PASSWORD ?? 'owner-password',
  name: process.env.SEED_OWNER_NAME ?? 'Owner',
}

export async function signIn(page: Page, user: { email: string; password: string } = owner) {
  await page.goto('/login')
  await page.getByLabel(text.email).fill(user.email)
  await page.getByLabel(text.password).fill(user.password)
  await page.getByRole('button', { name: text.signIn }).click()
  await expect(page.getByRole('heading', { name: text.dashboard })).toBeVisible()
}

/** A value unique to this test run, so tests never collide on shared data. */
export function unique(prefix: string) {
  return `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}
