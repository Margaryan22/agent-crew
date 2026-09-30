import { expect, test } from '@playwright/test'
import { accounts, createOrder, fillOrder, futureDate, open, signIn, uid } from './helpers'

test.beforeEach(async ({ page }) => {
  await signIn(page, accounts.owner)
})

test('staff enter an order and see its total', async ({ page }) => {
  await fillOrder(page, {
    customer: `Anna ${uid()}`,
    date: futureDate(),
    items: [
      { product: 'Sourdough loaf', quantity: 2 },
      { product: 'Croissant', quantity: 4 },
    ],
  })
  await expect(page.getByText('Total: $22.00')).toBeVisible()
  await page.getByRole('button', { name: 'Save order' }).click()
  await expect(page.getByText('Order saved')).toBeVisible()
  await expect(page.getByText(/Order #\d+/)).toBeVisible()
})

test('the order is listed for its pickup date', async ({ page }) => {
  const date = futureDate()
  const customer = `Boris ${uid()}`
  await createOrder(page, { customer, date, items: [{ product: 'Birthday cake', quantity: 1 }] })
  await open(page, `/orders?date=${date}`)
  const row = page.getByRole('row').filter({ hasText: customer })
  await expect(row).toContainText('$30.00')
  await expect(row).toContainText('New')
})

test('an order moves from new to picked up', async ({ page }) => {
  await createOrder(page, { customer: `Clara ${uid()}`, date: futureDate(), items: [{ product: 'Croissant', quantity: 6 }] })
  await expect(page.getByText('Status: New')).toBeVisible()
  await page.getByRole('button', { name: 'Start baking' }).click()
  await expect(page.getByText('Status: Baking')).toBeVisible()
  await page.getByRole('button', { name: 'Mark ready' }).click()
  await expect(page.getByText('Status: Ready')).toBeVisible()
  await page.getByRole('button', { name: 'Picked up' }).click()
  await expect(page.getByText('Status: Picked up')).toBeVisible()
})

test('the form refuses a past pickup date and a zero quantity', async ({ page }) => {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  await fillOrder(page, { customer: `Dan ${uid()}`, date: yesterday, items: [{ product: 'Croissant', quantity: 0 }] })
  await page.getByRole('button', { name: 'Save order' }).click()
  await expect(page.getByText('Choose a future pickup date')).toBeVisible()
  await expect(page.getByText('Quantity must be at least 1')).toBeVisible()
  await expect(page.getByText('Order saved')).toHaveCount(0)
})
