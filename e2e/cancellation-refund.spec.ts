import { expect, test } from '@playwright/test'

const projectId = '00000000-0000-4000-8000-000000000002'

test('cancellation and manual refund controls remain usable without layout overflow', async ({ page }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', error => runtimeErrors.push(error.message))

  await page.goto(`/login?redirect=${encodeURIComponent(`/project/${projectId}`)}`)
  await page.getByLabel('Email').fill('member@example.test')
  await page.getByLabel('Password').fill('test-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(new RegExp(`/project/${projectId}$`), { timeout: 15_000 })
  await expect(page.locator('html[data-auth-privacy-ready="true"]')).toHaveCount(1)

  await page.getByRole('tab', { name: 'Payments' }).click()
  await expect(page.getByRole('heading', { name: 'Leave With Refund' })).toBeVisible()
  await expect(page.getByText('Test Collector: sent')).toBeVisible()
  await expect(page.getByText('Amount €50.00')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Confirm this refund received' })).toBeVisible()

  await page.getByRole('tab', { name: 'Admin' }).click()
  await expect(page.getByText('Cancellation stops new project activity and keeps payment history.')).toBeVisible()
  const cancelButton = page.getByRole('button', { name: 'Cancel project' })
  await expect(cancelButton).toBeEnabled()
  page.once('dialog', dialog => dialog.dismiss())
  await cancelButton.click()
  await expect(cancelButton).toBeVisible()

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  expect(runtimeErrors).toEqual([])
})
