import { expect, test } from '@playwright/test'
import { owner, signIn, text } from './helpers'

test('the start page shows the app name', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: text.appName })).toBeVisible()
})

test('the owner signs in and out', async ({ page }) => {
  await signIn(page)
  await expect(page.getByText(text.signedInAs(owner.name))).toBeVisible()
  await page.getByRole('button', { name: text.signOut }).click()
  await expect(page).toHaveURL(/\/login/)
})

test('a wrong password shows an error', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel(text.email).fill(owner.email)
  await page.getByLabel(text.password).fill('not-the-password')
  await page.getByRole('button', { name: text.signIn }).click()
  await expect(page.getByRole('alert')).toHaveText(text.wrongCredentials)
  await expect(page).toHaveURL(/\/login/)
})

test('pages behind sign-in send visitors to the sign-in page and back', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login\?redirect=/)
  await page.getByLabel(text.email).fill(owner.email)
  await page.getByLabel(text.password).fill(owner.password)
  await page.getByRole('button', { name: text.signIn }).click()
  await expect(page.getByRole('heading', { name: text.dashboard })).toBeVisible()
})
