import { expect, type Page } from '@playwright/test'

export const accounts = {
  owner: { email: 'owner@stock.test', password: 'owner-pass-1' },
  keeper: { email: 'keeper@stock.test', password: 'keeper-pass-1' },
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
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

/** Creates a product as the owner and stays on its page. */
export async function createProduct(page: Page, p: { name: string; sku: string; unit?: string; min?: number }) {
  await open(page, '/products')
  await page.getByRole('button', { name: 'New product' }).or(page.getByRole('link', { name: 'New product' })).first().click()
  await page.getByLabel('Name').fill(p.name)
  await page.getByLabel('SKU').fill(p.sku)
  await page.getByLabel('Unit').fill(p.unit ?? 'pcs')
  await page.getByLabel('Minimum stock').fill(String(p.min ?? 0))
  await page.getByRole('button', { name: 'Save product' }).click()
}

/** On a product page: records a receipt or a shipment. */
export async function move(page: Page, kind: 'Receive' | 'Ship', quantity: number, note?: string) {
  await page.getByRole('button', { name: kind, exact: true }).click()
  await page.getByLabel('Quantity').fill(String(quantity))
  if (note) await page.getByLabel('Note').fill(note)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
}

export async function openProduct(page: Page, name: string) {
  await open(page, '/products')
  await page.getByLabel('Search products').fill(name)
  await page.getByLabel('Search products').press('Enter')
  await page.getByRole('link', { name }).click()
}

export function inStock(page: Page, n: number) {
  return expect(page.getByText(new RegExp(`In stock:\\s*${n}\\b`))).toBeVisible()
}
