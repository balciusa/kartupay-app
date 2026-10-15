import { expect, test, type Page } from '@playwright/test'

const projectId = '00000000-0000-4000-8000-000000000002'
const projectPath = `/project/${projectId}`

test.describe.configure({ mode: 'serial' })

async function login(page: Page) {
  await page.goto(`/login?redirect=${encodeURIComponent(projectPath)}`)
  await page.getByLabel('Email').fill('member@example.test')
  await page.getByLabel('Password').fill('test-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(new RegExp(`${projectPath}$`), { timeout: 15_000 })
  await expect(page.locator('[data-private-project-content="true"]')).toHaveCount(1)
}

async function expectNoPrivateContent(page: Page) {
  await expect(page.locator('[data-private-project-content="true"]')).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'Payments' })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'Admin' })).toHaveCount(0)
}

test('refund completion removes former-member private content before the membership mutation resolves', async ({ page }) => {
  await login(page)
  await page.goto(`${projectPath}?tab=payments`)
  await expect(page.getByRole('heading', { name: 'Leave With Refund' })).toBeVisible()

  await page.evaluate(() => {
    let accessBlockObserved = false
    const inspect = () => {
      if (document.querySelector('[data-project-access="blocked"]')) accessBlockObserved = true
      if (accessBlockObserved && document.querySelector('[data-private-project-content="true"]')) {
        window.sessionStorage.setItem('former-member-private-exposure', 'exposed')
      }
    }
    inspect()
    new MutationObserver(inspect).observe(document.body, { childList: true, subtree: true })
  })

  await page.getByRole('button', { name: 'Confirm this refund received' }).click()
  await expect(page.locator('[data-project-access="blocked"]')).toBeVisible()
  await expectNoPrivateContent(page)

  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expectNoPrivateContent(page)

  await expect(page.getByText('Private project', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Private browser regression project')).toHaveCount(0)
  await expect(page.getByText('Invite-safe project description')).toHaveCount(0)
  await expectNoPrivateContent(page)
  await expect.poll(async () => {
    try {
      return await page.evaluate(() => window.sessionStorage.getItem('former-member-private-exposure'))
    } catch {
      return 'navigation-in-progress'
    }
  })
    .toBeNull()

  await page.reload()
  await expect(page.getByText('Private project', { exact: true })).toBeVisible()
  await expect(page.getByText('Private browser regression project')).toHaveCount(0)
  await expectNoPrivateContent(page)

  await page.goBack()
  await expectNoPrivateContent(page)

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('refund-triggered membership loss blocks another open project tab', async ({ context, page }) => {
  await login(page)
  await page.goto(`${projectPath}?tab=payments`)
  await expect(page.getByRole('button', { name: 'Confirm this refund received' })).toBeVisible()

  const secondTab = await context.newPage()
  await secondTab.goto(projectPath)
  await expect(secondTab.locator('[data-private-project-content="true"]')).toHaveCount(1)
  await secondTab.evaluate(() => {
    let accessBlockObserved = false
    const inspect = () => {
      if (document.querySelector('[data-project-access="blocked"]')) accessBlockObserved = true
      if (accessBlockObserved && document.querySelector('[data-private-project-content="true"]')) {
        window.sessionStorage.setItem('cross-tab-former-member-exposure', 'exposed')
      }
    }
    inspect()
    new MutationObserver(inspect).observe(document.body, { childList: true, subtree: true })
  })

  await page.getByRole('button', { name: 'Confirm this refund received' }).click()
  await expect(secondTab.locator('[data-project-access="blocked"]')).toBeVisible()
  await expectNoPrivateContent(secondTab)
  await expect(secondTab.getByText('Private project', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect.poll(async () => {
    try {
      return await secondTab.evaluate(() => window.sessionStorage.getItem('cross-tab-former-member-exposure'))
    } catch {
      return 'navigation-in-progress'
    }
  })
    .toBeNull()
})
