import { expect, type Page } from '@playwright/test'

export const accounts = {
  owner: { email: 'owner@bakery.test', password: 'owner-pass-1' },
  baker: { email: 'baker@bakery.test', password: 'baker-pass-1' },
}

/** A random date 30–630 days ahead, so tests never share a pickup day. */
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

export interface Order {
  customer: string
  phone?: string
  date: string
  items: Array<{ product: string; quantity: number }>
}

/** Fills the new-order form (not saved). */
export async function fillOrder(page: Page, o: Order) {
  await open(page, '/orders/new')
  await page.getByLabel('Customer name').fill(o.customer)
  await page.getByLabel('Phone').fill(o.phone ?? '+1 555 0100')
  await page.getByLabel('Pickup date').fill(o.date)
  for (const [i, item] of o.items.entries()) {
    if (i > 0) await page.getByRole('button', { name: 'Add item' }).click()
    await page.getByLabel('Product').nth(i).selectOption({ label: item.product })
    await page.getByLabel('Quantity').nth(i).fill(String(item.quantity))
  }
}

/** Enters and saves an order; stays on its page. */
export async function createOrder(page: Page, o: Order) {
  await fillOrder(page, o)
  await page.getByRole('button', { name: 'Save order' }).click()
  await expect(page.getByText('Order saved')).toBeVisible()
}

export function productionRow(page: Page, product: string, quantity: number) {
  return expect(page.getByText(new RegExp(`${product}\\s*[—–-]\\s*${quantity}\\b`))).toBeVisible()
}
