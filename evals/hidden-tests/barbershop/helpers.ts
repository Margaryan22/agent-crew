import { expect, type Page } from '@playwright/test'

export const accounts = {
  owner: { email: 'owner@barber.test', password: 'owner-pass-1' },
  ivan: { email: 'ivan@barber.test', password: 'ivan-pass-1' },
  sergey: { email: 'sergey@barber.test', password: 'sergey-pass-1' },
}

/** A random date 30–630 days ahead, so tests never share a day. */
export function futureDate(): string {
  const d = new Date()
  d.setDate(d.getDate() + 30 + Math.floor(Math.random() * 600))
  return d.toISOString().slice(0, 10)
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 8)
}

/** Opens a page and waits until its scripts have loaded, so the UI is interactive. */
export async function open(page: Page, url: string) {
  await page.goto(url)
  await page.waitForLoadState('networkidle')
}

export async function signIn(page: Page, account: { email: string; password: string }) {
  await open(page, '/login')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password').fill(account.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

export interface Booking {
  barber?: string
  service?: string
  date: string
  time?: string
  name: string
  phone?: string
}

/** Fills the public booking form up to (not including) the Book button. */
export async function fillBooking(page: Page, b: Booking) {
  await open(page, '/book')
  await page.getByLabel('Barber').selectOption({ label: b.barber ?? 'Ivan' })
  await page.getByLabel('Service').selectOption({ label: b.service ?? 'Haircut' })
  await page.getByLabel('Date').fill(b.date)
  const time = page.getByLabel('Time')
  await expect(time.locator('option', { hasText: b.time ?? '10:00' })).toHaveCount(1)
  await time.selectOption({ label: b.time ?? '10:00' })
  await page.getByLabel('Your name').fill(b.name)
  await page.getByLabel('Phone').fill(b.phone ?? '+1 555 0100')
}

export async function book(page: Page, b: Booking) {
  await fillBooking(page, b)
  await page.getByRole('button', { name: 'Book' }).click()
  await expect(page.getByText('Booking confirmed')).toBeVisible()
}
