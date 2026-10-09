import { expect, test, type Page } from '@playwright/test'

function recordRuntimeErrors(page: Page) {
  const errors: string[] = []

  page.on('pageerror', error => {
    errors.push('pageerror: ' + error.message)
  })
  page.on('console', message => {
    if (message.type() === 'error') {
      errors.push('console: ' + message.text())
    }
  })

  return errors
}

test('homepage loads its primary controls without runtime errors or overflow', async ({ page }) => {
  const runtimeErrors = recordRuntimeErrors(page)
  const response = await page.goto('/')

  expect(response?.ok()).toBe(true)
  await expect(page).toHaveTitle('KartuPay')
  await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'New project' })).toBeVisible()
  await expect(page.getByRole('searchbox', { name: 'Search' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Project status filters' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Sort' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible()

  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth)

  await page.getByRole('button', { name: 'New project' }).click()
  const newProjectDialog = page.getByRole('dialog', { name: 'New project' })
  await expect(newProjectDialog).toBeVisible()
  await newProjectDialog.getByRole('button', { name: 'Cancel', exact: true }).first().click()
  await expect(newProjectDialog).toBeHidden()

  expect(runtimeErrors).toEqual([])
})

test('login navigation works', async ({ page }) => {
  const runtimeErrors = recordRuntimeErrors(page)
  await page.goto('/')

  await page.getByRole('link', { name: 'Log in' }).click()

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Log in', level: 1 })).toBeVisible()
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByLabel('Password')).toBeVisible()
  expect(runtimeErrors).toEqual([])
})
