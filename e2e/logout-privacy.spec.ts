import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test'

const projectId = '00000000-0000-4000-8000-000000000002'
const projectPath = `/project/${projectId}`
const logoutEndpoint = '**/auth/v1/logout**'

// Logout intentionally broadcasts across same-origin tabs, so these scenarios
// must not send competing auth-exit signals in parallel.
test.describe.configure({ mode: 'serial' })

async function login(context: BrowserContext, page: Page) {
  await page.goto(`/login?redirect=${encodeURIComponent(projectPath)}`)
  await page.getByLabel('Email').fill('member@example.test')
  await page.getByLabel('Password').fill('test-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(new RegExp(`${projectPath}$`), { timeout: 15_000 })
  await expectPrivateProjectContent(page)
  await expect(page.locator('html[data-auth-privacy-ready="true"]')).toHaveCount(1)

  // Confirm the authenticated browser context is reusable by additional tabs.
  await expect.poll(() => context.cookies().then(cookies => cookies.some(cookie => cookie.name.startsWith('sb-')))).toBe(true)
}

async function openAuthenticatedProject(context: BrowserContext) {
  const page = await context.newPage()
  await page.goto(projectPath)
  await expectPrivateProjectContent(page)
  await expect(page.locator('html[data-auth-privacy-ready="true"]')).toHaveCount(1)
  return page
}

async function expectPrivateProjectContent(page: Page) {
  await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('[data-private-project-content="true"]')).toHaveCount(1)
}

async function expectNoPrivateProjectContent(page: Page) {
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'Admin' })).toHaveCount(0)
  await expect(page.locator('[data-private-project-content="true"]')).toHaveCount(0)
}

async function recordPrivateExposureAfterBlock(page: Page, marker: string) {
  await page.evaluate(markerName => {
    let blockObserved = false
    const inspect = () => {
      if (document.querySelector('[data-auth-privacy="blocked"]')) blockObserved = true
      if (blockObserved && document.querySelector('[data-private-project-content="true"]')) {
        window.sessionStorage.setItem(markerName, 'exposed')
      }
    }
    inspect()
    new MutationObserver(inspect).observe(document.body, { childList: true, subtree: true })
  }, marker)
}

async function delayRoute(route: Route, delayMs: number, status: number) {
  await new Promise(resolve => setTimeout(resolve, delayMs))
  if (status >= 400) {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Intentional E2E logout failure' }),
    })
    return
  }
  await route.fulfill({ status })
}

test('logout stays blocked through visibility and BFCache revalidation races', async ({ context, page }) => {
  await login(context, page)
  await recordPrivateExposureAfterBlock(page, 'revalidation-race-exposure')
  await page.route(logoutEndpoint, route => delayRoute(route, 700, 204))

  await page.getByRole('button', { name: 'Logout' }).click()
  await expect(page.locator('[data-auth-privacy="blocked"]')).toBeVisible()

  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForTimeout(150)

  await expect(page.locator('[data-auth-privacy="blocked"]')).toBeVisible()
  await expectNoPrivateProjectContent(page)
  await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('revalidation-race-exposure')))
    .toBeNull()

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  await expectNoPrivateProjectContent(page)
})

test('a login tab finishes logout and Back cannot restore private content', async ({ context, page }) => {
  await login(context, page)
  const logoutTab = await openAuthenticatedProject(context)

  // Keep the private project as an earlier real history entry.
  await page.goto('/login')
  await expect(page).toHaveURL(/\/login$/)

  await logoutTab.getByRole('button', { name: 'Logout' }).click()

  // The completed message must reload an already-open /login route rather
  // than leaving its privacy screen mounted forever.
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  await expect(page.locator('[data-auth-privacy="blocked"]')).toHaveCount(0)
  await expectNoPrivateProjectContent(page)

  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`${projectPath}$`))
  await expect(page.getByText('Sign in to continue')).toBeVisible()
  await expectNoPrivateProjectContent(page)
})

test('one failed logout restores authenticated content only after session revalidation', async ({ context, page }) => {
  await login(context, page)
  const secondTab = await openAuthenticatedProject(context)
  await page.route(logoutEndpoint, route => delayRoute(route, 250, 500))

  await page.getByRole('button', { name: 'Logout' }).click()
  await expect(page.locator('[data-auth-privacy="blocked"]')).toBeVisible()
  await expect(secondTab.locator('[data-auth-privacy="blocked"]')).toBeVisible()

  await expectPrivateProjectContent(page)
  await expectPrivateProjectContent(secondTab)
  await expect(page.getByText('Logout failed. Please try again.')).toHaveCount(1)
})

test('a failed concurrent logout cannot reveal content while another attempt is pending', async ({ context, page }) => {
  await login(context, page)
  const secondTab = await openAuthenticatedProject(context)
  await recordPrivateExposureAfterBlock(page, 'first-concurrent-exposure')
  await recordPrivateExposureAfterBlock(secondTab, 'second-concurrent-exposure')

  await page.route(logoutEndpoint, route => delayRoute(route, 200, 500))
  await secondTab.route(logoutEndpoint, route => delayRoute(route, 900, 204))

  await Promise.all([
    page.getByRole('button', { name: 'Logout' }).click(),
    secondTab.getByRole('button', { name: 'Logout' }).click(),
  ])

  // The first attempt has failed, but the second stable attempt ID remains
  // active and must keep both tabs blocked.
  await page.waitForTimeout(350)
  await expect(page.locator('[data-auth-privacy="blocked"]')).toBeVisible()
  await expect(secondTab.locator('[data-auth-privacy="blocked"]')).toBeVisible()
  await expectNoPrivateProjectContent(page)
  await expectNoPrivateProjectContent(secondTab)
  await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('first-concurrent-exposure')))
    .toBeNull()
  await expect.poll(() => secondTab.evaluate(() => window.sessionStorage.getItem('second-concurrent-exposure')))
    .toBeNull()

  await expect(page).toHaveURL(/\/login$/)
  await expect(secondTab).toHaveURL(/\/login$/)
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  await expect(secondTab.getByRole('button', { name: 'Sign in' })).toBeVisible()
})

test('a restored page rejects an expired session when refresh fails', async ({ context, page }) => {
  await login(context, page)
  await recordPrivateExposureAfterBlock(page, 'expired-session-exposure')

  const authCookie = (await context.cookies()).find(cookie => cookie.name.startsWith('sb-'))
  if (!authCookie) throw new Error('Expected an authenticated Supabase cookie')

  const expiredPayload = Buffer.from(JSON.stringify({
    sub: '00000000-0000-4000-8000-000000000001',
    email: 'member@example.test',
    role: 'authenticated',
    aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) - 60,
  })).toString('base64url')
  const expiredSession = {
    access_token: `e2e.${expiredPayload}.signature`,
    token_type: 'bearer',
    expires_in: 0,
    expires_at: Math.floor(Date.now() / 1000) - 60,
    refresh_token: 'expired-e2e-refresh-token',
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'member@example.test',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      created_at: '2026-01-01T00:00:00.000Z',
    },
  }

  await context.clearCookies()
  await context.addCookies([{
    name: authCookie.name.replace(/\.\d+$/, ''),
    value: `base64-${Buffer.from(JSON.stringify(expiredSession)).toString('base64url')}`,
    domain: authCookie.domain,
    path: '/',
    httpOnly: false,
    secure: false,
    sameSite: 'Lax',
  }])
  await page.route('**/auth/v1/token**', route => route.fulfill({
    status: 400,
    contentType: 'application/json',
    body: JSON.stringify({ message: 'Expired E2E refresh token' }),
  }))
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
  })

  await expectNoPrivateProjectContent(page)
  await expect(page).toHaveURL(/\/login$/)
  await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('expired-session-exposure')))
    .toBeNull()
})
