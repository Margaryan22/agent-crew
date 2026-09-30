import { expect, test } from '@playwright/test'
import { accounts, createOrder, futureDate, open, productionRow, signIn, uid } from './helpers'

test('production sums quantities of the day and skips cancelled orders', async ({ page }) => {
  await signIn(page, accounts.baker)
  const date = futureDate()
  await createOrder(page, { customer: `Eva ${uid()}`, date, items: [{ product: 'Sourdough loaf', quantity: 2 }] })
  await createOrder(page, {
    customer: `Fred ${uid()}`,
    date,
    items: [
      { product: 'Sourdough loaf', quantity: 3 },
      { product: 'Birthday cake', quantity: 1 },
    ],
  })
  await createOrder(page, { customer: `Gina ${uid()}`, date, items: [{ product: 'Croissant', quantity: 9 }] })
  await page.getByRole('button', { name: 'Cancel order' }).click()
  await expect(page.getByText('Status: Cancelled')).toBeVisible()

  await open(page, `/production?date=${date}`)
  await productionRow(page, 'Sourdough loaf', 5)
  await productionRow(page, 'Birthday cake', 1)
  await expect(page.getByText(/Croissant\s*[—–-]\s*9\b/)).toHaveCount(0)
})

test('revenue counts picked-up orders only', async ({ page }) => {
  await signIn(page, accounts.owner)
  const date = futureDate()
  await createOrder(page, { customer: `Hugo ${uid()}`, date, items: [{ product: 'Birthday cake', quantity: 1 }] })
  await page.getByRole('button', { name: 'Start baking' }).click()
  await page.getByRole('button', { name: 'Mark ready' }).click()
  await page.getByRole('button', { name: 'Picked up' }).click()
  await expect(page.getByText('Status: Picked up')).toBeVisible()
  await createOrder(page, { customer: `Ines ${uid()}`, date, items: [{ product: 'Sourdough loaf', quantity: 1 }] })

  await open(page, '/reports')
  await page.getByLabel('From').fill(date)
  await page.getByLabel('To').fill(date)
  await page.getByRole('button', { name: 'Show' }).click()
  await expect(page.getByText('Revenue: $30.00')).toBeVisible()
})

test('the baker cannot open the revenue report', async ({ page }) => {
  await signIn(page, accounts.baker)
  await open(page, '/reports')
  await expect(page).toHaveURL(/\/orders/)
})
