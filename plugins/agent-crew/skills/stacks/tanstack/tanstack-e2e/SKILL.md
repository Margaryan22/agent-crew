---
name: tanstack-e2e
description: Tests in the tanstack profile — Playwright end-to-end tests (config, running, sign-in helper, selectors by role and label, test data isolation, several roles at once, downloads, checking server-side permissions) and Vitest unit tests for business logic. Use when writing, running or fixing tests.
user-invocable: false
paths:
  - e2e/**
  - tests/**
  - playwright.config.ts
  - vitest.config.ts
---

# Tests: Playwright and Vitest

## Running

```bash
npm run setup                                   # database up, migrated, seeded (once per session)
npx playwright install chromium                 # once per machine
npm run test:e2e                                # all e2e tests; starts the dev server itself
npx playwright test e2e/booking.spec.ts         # one file
npx playwright test -g "AC-04"                  # by name
npm test                                        # Vitest unit tests (tests/**/*.test.ts)
```

`playwright.config.ts` reuses a dev server that is already running on port 3000, and loads `.env` (seed account). With `BASE_URL` set it tests that URL instead and starts nothing. Failures leave a trace: `npx playwright show-trace test-results/…/trace.zip`.

## Writing e2e tests (`e2e/*.spec.ts`)

```ts
import { expect, test } from '@playwright/test'
import { owner, signIn, text, unique } from './helpers'

test('AC-03 staff books a free slot for a client', async ({ page }) => {
  await signIn(page)                                      // owner from .env; signIn(page, { email, password }) for others
  await page.goto('/clients/new')
  const name = unique('Client')                           // unique data: tests never collide
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Phone').fill(`+7 900 ${Math.floor(1000000 + Math.random() * 8999999)}`)
  await page.getByRole('button', { name: 'Save client' }).click()
  await expect(page.getByRole('status')).toHaveText('Client saved')
  await expect(page.getByRole('heading', { name })).toBeVisible()
})
```

- Name tests after the acceptance criterion: `AC-03 …`.
- Selectors, in order: `getByRole(role, { name })`, `getByLabel`, `getByText` for messages, `getByTestId` last. The names come from `docs/ui-contract.md`; strings of the template screens come from `text` (`src/lib/text.ts`).
- Assert what the user sees (`toBeVisible`, `toHaveText`, `toHaveURL`); Playwright waits automatically — no `waitForTimeout`.
- Each test creates the data it needs through the UI (or relies only on the seed) and works in any order.

## Several roles at once

```ts
test('AC-09 staff cannot see revenue', async ({ page, browser }) => {
  const staffContext = await browser.newContext()
  const staff = await staffContext.newPage()
  await signIn(staff, { email: 'staff@example.com', password: 'staff-password' })
  await staff.goto('/reports/revenue')
  await expect(staff).toHaveURL(/\/dashboard/)                                  // the page is hidden…
  expect((await staff.request.get('/api/reports/revenue.csv?year=2026')).status()).toBe(403)   // …and the server refuses
  await staffContext.close()
})
```

`page.request` shares the page's cookies — use it to prove the server enforces a permission, not only the UI.

## Downloads

```ts
const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download CSV' }).click()])
expect(download.suggestedFilename()).toBe('revenue-2026.csv')
```

## Unit tests (`tests/**/*.test.ts`, Vitest)

For pure business logic — prices, slot calculation, validation schemas, formatting — not for UI:

```ts
import { describe, expect, it } from 'vitest'
import { clientInput } from '#/lib/validation/clients'

describe('clientInput', () => {
  it('rejects a phone without digits', () => {
    expect(clientInput.safeParse({ name: 'A', phone: 'call me' }).success).toBe(false)
  })
})
```

Put logic that needs tests into plain functions (`src/lib/…` or `*.server.ts`) so it can be tested without the database or a browser.
