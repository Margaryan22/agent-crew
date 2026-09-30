import { expect, test } from '@playwright/test'
import { accounts, book, futureDate, open, signIn, uid } from './helpers'

test('the owner sees a booking in the schedule and cancels it, which frees the time', async ({ page, browser }) => {
  const date = futureDate()
  const name = `Client ${uid()}`
  await book(page, { date, time: '12:00', name })

  const owner = await (await browser.newContext()).newPage()
  await signIn(owner, accounts.owner)
  await open(owner, `/schedule?date=${date}`)
  const row = owner.getByRole('row').filter({ hasText: name })
  await expect(row).toContainText('12:00')
  await expect(row).toContainText('Ivan')
  await expect(row).toContainText('Haircut')
  await row.getByRole('button', { name: 'Cancel' }).click()
  await owner.getByRole('button', { name: 'Yes, cancel' }).click()
  await expect(owner.getByRole('row').filter({ hasText: name })).toHaveCount(0)

  await open(page, '/book')
  await page.getByLabel('Barber').selectOption({ label: 'Ivan' })
  await page.getByLabel('Service').selectOption({ label: 'Haircut' })
  await page.getByLabel('Date').fill(date)
  await expect(page.getByLabel('Time').locator('option', { hasText: '12:00' })).toHaveCount(1)
})

test('a barber sees only their own appointments', async ({ page, browser }) => {
  const date = futureDate()
  const forIvan = `Ivan client ${uid()}`
  const forSergey = `Sergey client ${uid()}`
  await book(page, { barber: 'Ivan', date, time: '13:00', name: forIvan })
  await book(page, { barber: 'Sergey', date, time: '13:00', name: forSergey })

  const ivan = await (await browser.newContext()).newPage()
  await signIn(ivan, accounts.ivan)
  await open(ivan, `/schedule?date=${date}`)
  await expect(ivan.getByRole('row').filter({ hasText: forIvan })).toHaveCount(1)
  await expect(ivan.getByText(forSergey)).toHaveCount(0)
})

test('barbers cannot open the revenue report', async ({ page }) => {
  await signIn(page, accounts.sergey)
  await open(page, '/reports')
  await expect(page).toHaveURL(/\/schedule/)
})

test('the revenue report sums bookings that are not cancelled', async ({ page, browser }) => {
  const date = futureDate()
  const cancelled = `Cancelled ${uid()}`
  await book(page, { barber: 'Ivan', service: 'Haircut', date, time: '14:00', name: `A ${uid()}` })
  await book(page, { barber: 'Sergey', service: 'Beard trim', date, time: '14:00', name: `B ${uid()}` })
  await book(page, { barber: 'Ivan', service: 'Haircut', date, time: '15:00', name: cancelled })

  const owner = await (await browser.newContext()).newPage()
  await signIn(owner, accounts.owner)
  await open(owner, `/schedule?date=${date}`)
  await owner.getByRole('row').filter({ hasText: cancelled }).getByRole('button', { name: 'Cancel' }).click()
  await owner.getByRole('button', { name: 'Yes, cancel' }).click()
  await expect(owner.getByText(cancelled)).toHaveCount(0)

  await open(owner, '/reports')
  await owner.getByLabel('From').fill(date)
  await owner.getByLabel('To').fill(date)
  await owner.getByRole('button', { name: 'Show' }).click()
  await expect(owner.getByText('Total: $40.00')).toBeVisible()
})
