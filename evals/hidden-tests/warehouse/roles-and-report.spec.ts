import { expect, test } from '@playwright/test'
import { accounts, createProduct, inStock, move, open, openProduct, signIn, uid } from './helpers'

test('the storekeeper moves goods but cannot manage products', async ({ page, browser }) => {
  const name = `Boxes ${uid()}`
  await signIn(page, accounts.owner)
  await createProduct(page, { name, sku: `BX-${uid()}` })
  await expect(page.getByText('Product saved')).toBeVisible()

  const keeper = await (await browser.newContext()).newPage()
  await signIn(keeper, accounts.keeper)
  await open(keeper, '/products')
  await expect(keeper.getByRole('button', { name: 'New product' }).or(keeper.getByRole('link', { name: 'New product' }))).toHaveCount(0)
  await openProduct(keeper, name)
  await move(keeper, 'Receive', 4)
  await inStock(keeper, 4)
  await expect(keeper.getByRole('button', { name: 'Delete product' })).toHaveCount(0)
})

test('the movement report totals receipts and shipments per product', async ({ page }) => {
  const name = `Cable ${uid()}`
  await signIn(page, accounts.owner)
  await createProduct(page, { name, sku: `CB-${uid()}` })
  await move(page, 'Receive', 10)
  await inStock(page, 10)
  await move(page, 'Receive', 5)
  await inStock(page, 15)
  await move(page, 'Ship', 4)
  await inStock(page, 11)

  const today = new Date().toISOString().slice(0, 10)
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  await open(page, '/reports')
  await page.getByLabel('From').fill(today)
  await page.getByLabel('To').fill(tomorrow)
  await page.getByRole('button', { name: 'Show' }).click()
  const row = page.getByRole('row').filter({ hasText: name })
  await expect(row.getByRole('cell').nth(1)).toHaveText('15')
  await expect(row.getByRole('cell').nth(2)).toHaveText('4')
})
