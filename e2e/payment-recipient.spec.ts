import { expect, test } from '@playwright/test'

const projectPath = '/project/00000000-0000-4000-8000-000000000002'

test('IBAN recipient feedback matches server validation without submitting payment data', async ({ page }) => {
  await page.goto(`/login?redirect=${encodeURIComponent(projectPath)}`)
  await page.getByLabel('Email').fill('member@example.test')
  await page.getByLabel('Password').fill('test-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(new RegExp(`${projectPath}$`), { timeout: 15_000 })
  await expect(page.locator('html[data-auth-privacy-ready="true"]')).toHaveCount(1)
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')

  const profileTab = page.getByRole('tab', { name: 'Profile' })
  await profileTab.click()
  await expect(profileTab).toHaveAttribute('aria-selected', 'true')
  const recipientForm = page.getByRole('heading', { name: 'Payment recipients' }).locator('..')
  const form = recipientForm.locator('form')
  await recipientForm.getByLabel('Payment method').selectOption('iban')

  const recipientName = recipientForm.locator('input[name="plabel"]')
  const iban = recipientForm.locator('input[name="pvalue"]')
  await recipientName.fill('Élodie Martin')
  await iban.fill('FR15 2004 1010 0505 0001 3M02 606')
  await iban.blur()

  await expect(recipientForm.getByRole('alert')).toHaveText('IBAN checksum is invalid')
  await expect(iban).toHaveAttribute('aria-invalid', 'true')
  expect(await form.evaluate(element => (element as HTMLFormElement).checkValidity())).toBe(false)

  await iban.fill('fr14 2004 1010 0505 0001 3m02 606')
  await expect(recipientForm.getByRole('alert')).toHaveCount(0)
  await expect(iban).toHaveAttribute('aria-invalid', 'false')
  expect(await form.evaluate(element => (element as HTMLFormElement).checkValidity())).toBe(true)

  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth)
})
