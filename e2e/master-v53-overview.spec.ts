import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

const projectId = '00000000-0000-4000-8000-000000000002'
const screenshotDirectory = join(process.cwd(), 'docs', 'screenshots', 'master-v53-pr01')
const shouldWriteScreenshots = process.env.UPDATE_MASTER_V53_SCREENSHOTS === '1'

test.use({ locale: 'lt-LT' })
test.describe.configure({ mode: 'serial' })

async function openOverview(page: Page, email: string) {
  await page.goto(`/login?redirect=${encodeURIComponent(`/project/${projectId}`)}`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('test-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(new RegExp(`/project/${projectId}$`), { timeout: 15_000 })
  await expect(page.locator('html[data-auth-privacy-ready="true"]')).toHaveCount(1)
}

async function assertMasterOverview(page: Page) {
  const primaryTabs = page.locator('[data-primary-tab]')
  await expect(primaryTabs).toHaveCount(4)
  await expect(primaryTabs.locator(':scope > span:first-child')).toHaveText(['Apžvalga', 'Grupė', 'Planas', 'Finansai'])
  await expect(page.getByRole('heading', { name: 'Apžvalga', exact: true })).toBeVisible()
  await expect(page.getByText('Svarbiausias kitas žingsnis ir tai, kas dar liko.')).toBeVisible()
  await expect(page.getByText('KĄ SVARBIAUSIA PADARYTI DABAR')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Kiti klausimai' })).toBeVisible()
  const primaryActionCount = await page.locator('[data-primary-action]').count()
  expect(primaryActionCount).toBeLessThanOrEqual(1)
  if (primaryActionCount === 0) {
    await expect(page.getByRole('heading', { name: 'Šiuo metu veiksmų nereikia' })).toBeVisible()
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
}

for (const persona of [
  { name: 'participant', email: 'member@example.test' },
  { name: 'organizer', email: 'collector@example.test' },
] as const) {
  test(`MASTER v5.3 Overview and navigation render for ${persona.name}`, async ({ page }, testInfo) => {
    const runtimeErrors: string[] = []
    page.on('pageerror', error => runtimeErrors.push(error.message))

    await openOverview(page, persona.email)
    await assertMasterOverview(page)

    await page.getByRole('tab', { name: 'Planas', exact: true }).click()
    for (const label of ['Datos', 'Balsavimai', 'Papildomi pasirinkimai']) {
      await expect(page.getByRole('tab', { name: label, exact: true })).toBeVisible()
    }
    await page.getByRole('tab', { name: 'Apžvalga', exact: true }).click()

    if (shouldWriteScreenshots) {
      mkdirSync(screenshotDirectory, { recursive: true })
      await page.screenshot({
        path: join(screenshotDirectory, `after-${testInfo.project.name}-${persona.name}.png`),
        fullPage: true,
      })
    }

    expect(runtimeErrors).toEqual([])
  })
}
