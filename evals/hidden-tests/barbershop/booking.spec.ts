import { expect, test } from '@playwright/test'
import { book, fillBooking, futureDate, open, uid } from './helpers'

test('a client books a free time', async ({ page }) => {
  await book(page, { date: futureDate(), name: `Client ${uid()}` })
})

test('the same time cannot be taken twice', async ({ browser }) => {
  const date = futureDate()
  const first = await (await browser.newContext()).newPage()
  const second = await (await browser.newContext()).newPage()
  await fillBooking(first, { date, time: '11:00', name: `First ${uid()}` })
  await fillBooking(second, { date, time: '11:00', name: `Second ${uid()}` })
  await first.getByRole('button', { name: 'Book' }).click()
  await expect(first.getByText('Booking confirmed')).toBeVisible()
  await second.getByRole('button', { name: 'Book' }).click()
  await expect(second.getByText('This time is no longer available')).toBeVisible()
})

test('the booking form explains what is missing', async ({ page }) => {
  await fillBooking(page, { date: futureDate(), name: '' })
  await page.getByLabel('Phone').fill('')
  await page.getByRole('button', { name: 'Book' }).click()
  await expect(page.getByText('Enter your name')).toBeVisible()
  await expect(page.getByText('Enter your phone number')).toBeVisible()
  await expect(page.getByText('Booking confirmed')).toHaveCount(0)
})

test('a date in the past is refused', async ({ page }) => {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  await open(page, '/book')
  await page.getByLabel('Barber').selectOption({ label: 'Ivan' })
  await page.getByLabel('Service').selectOption({ label: 'Haircut' })
  await page.getByLabel('Date').fill(yesterday)
  await page.getByLabel('Your name').fill(`Late ${uid()}`)
  await page.getByLabel('Phone').fill('+1 555 0100')
  await page.getByRole('button', { name: 'Book' }).click()
  await expect(page.getByText('Choose a future date')).toBeVisible()
  await expect(page.getByText('Booking confirmed')).toHaveCount(0)
})
