import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const projectId = '00000000-0000-4000-8000-000000000002'
const projectPath = `/project/${projectId}`

// Logout intentionally broadcasts across same-origin tabs, so these scenarios
// must not send competing auth-exit signals in parallel.
test.describe.configure({ mode: 'serial' })

async function login(context: BrowserContext, page: Page) {
  await page.goto(`/login?redirect=${encodeURIComponent(projectPath)}`)
  await page.getByLabel('Email').fill('member@example.test')
  await page.getByLabel('Password').fill('test-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(new RegExp(`${projectPath}$`), { timeout: 15_000 })
  await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('html[data-auth-privacy-ready="true"]')).toHaveCount(1)

  // Confirm the authenticated browser context is reusable by additional tabs.
  await expect.poll(() => context.cookies().then(cookies => cookies.some(cookie => cookie.name.startsWith('sb-')))).toBe(true)
}

async function expectNoPrivateProjectContent(page: Page) {
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'Admin' })).toHaveCount(0)
}

async function recordPrivacyScreen(page: Page, marker: string) {
  await page.evaluate(markerName => {
    const observer = new MutationObserver(() => {
      const privacyScreen = document.querySelector('[data-auth-privacy="blocked"]')
      const privateTab = document.querySelector('[role="tab"]')
      if (privacyScreen && !privateTab) {
        window.sessionStorage.setItem(markerName, 'true')
        observer.disconnect()
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
  }, marker)
}

test('logout hides private content before the request completes and survives Back and direct access', async ({ context, page }) => {
  await login(context, page)
  await recordPrivacyScreen(page, 'privacy-screen-before-redirect')

  await page.getByRole('button', { name: 'Logout' }).click()

  await expectNoPrivateProjectContent(page)
  await expect(page).toHaveURL(/\/login$/)
  await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('privacy-screen-before-redirect')))
    .toBe('true')

  await page.goBack()
  await expect(page).not.toHaveURL(new RegExp(`${projectPath}$`))
  await expectNoPrivateProjectContent(page)

  await page.goto(projectPath)
  await expect(page.getByRole('heading', { name: 'Private browser regression project' })).toBeVisible()
  await expect(page.getByText('Sign in to continue')).toBeVisible()
  await expectNoPrivateProjectContent(page)
})

test('logout in another tab removes private content without a private-data flash', async ({ context, page }) => {
  await login(context, page)
  const secondTab = await context.newPage()
  await secondTab.goto(projectPath)
  await expect(secondTab.getByRole('tab', { name: 'Overview' })).toBeVisible()
  await recordPrivacyScreen(secondTab, 'cross-tab-privacy-screen')

  await page.getByRole('button', { name: 'Logout' }).click()

  await expectNoPrivateProjectContent(secondTab)
  await expect(secondTab).toHaveURL(/\/login$/)
  await expect.poll(() => secondTab.evaluate(() => window.sessionStorage.getItem('cross-tab-privacy-screen')))
    .toBe('true')
})

test('a restored page revalidates an expired session before showing private content', async ({ context, page }) => {
  await login(context, page)
  await recordPrivacyScreen(page, 'expired-session-privacy-screen')

  await context.clearCookies()
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
  })

  await expectNoPrivateProjectContent(page)
  await expect(page).toHaveURL(/\/login$/)
  await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('expired-session-privacy-screen')))
    .toBe('true')
})
