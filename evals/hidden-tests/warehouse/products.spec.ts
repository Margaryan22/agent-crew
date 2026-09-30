import { expect, test } from '@playwright/test'
import { accounts, createProduct, inStock, move, open, openProduct, signIn, uid } from './helpers'

test.beforeEach(async ({ page }) => {
  await signIn(page, accounts.owner)
})

test('the owner creates a product and finds it in the list', async ({ page }) => {
  const name = `Paper towels ${uid()}`
  const sku = `PT-${uid()}`
  await createProduct(page, { name, sku, unit: 'pcs', min: 2 })
  await expect(page.getByText('Product saved')).toBeVisible()
  await open(page, '/products')
  await page.getByLabel('Search products').fill(name)
  await page.getByLabel('Search products').press('Enter')
  const row = page.getByRole('row').filter({ hasText: name })
  await expect(row).toContainText(sku)
  await expect(row).toContainText('0')
})

test('a SKU cannot be used twice', async ({ page }) => {
  const sku = `DUP-${uid()}`
  await createProduct(page, { name: `First ${uid()}`, sku })
  await expect(page.getByText('Product saved')).toBeVisible()
  const second = `Second ${uid()}`
  await createProduct(page, { name: second, sku })
  await expect(page.getByText('A product with this SKU already exists')).toBeVisible()
  await open(page, '/products')
  await page.getByLabel('Search products').fill(second)
  await page.getByLabel('Search products').press('Enter')
  await expect(page.getByRole('row').filter({ hasText: second })).toHaveCount(0)
})

test('receiving and shipping change the stock', async ({ page }) => {
  await createProduct(page, { name: `Soap ${uid()}`, sku: `SP-${uid()}` })
  await move(page, 'Receive', 10, 'first delivery')
  await inStock(page, 10)
  await move(page, 'Ship', 3)
  await inStock(page, 7)
})

test('shipping more than is in stock is refused', async ({ page }) => {
  await createProduct(page, { name: `Tape ${uid()}`, sku: `TP-${uid()}` })
  await move(page, 'Receive', 2)
  await inStock(page, 2)
  await move(page, 'Ship', 5)
  await expect(page.getByText('Not enough stock')).toBeVisible()
  await page.reload()
  await inStock(page, 2)
})

test('products below their minimum are marked as low stock', async ({ page }) => {
  const name = `Gloves ${uid()}`
  await createProduct(page, { name, sku: `GL-${uid()}`, min: 5 })
  await move(page, 'Receive', 3)
  await inStock(page, 3)
  await open(page, '/products')
  await page.getByLabel('Search products').fill(name)
  await page.getByLabel('Search products').press('Enter')
  await expect(page.getByRole('row').filter({ hasText: name })).toContainText('Low stock')
  await open(page, '/low-stock')
  await expect(page.getByText(name)).toBeVisible()

  await openProduct(page, name)
  await move(page, 'Receive', 10)
  await inStock(page, 13)
  await open(page, '/low-stock')
  await expect(page.getByText(name)).toHaveCount(0)
})
