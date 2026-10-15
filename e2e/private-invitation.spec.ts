import { expect, test } from '@playwright/test'
import { createProjectInviteCapability } from '../src/lib/projectInviteCapability'

const projectId = '00000000-0000-4000-8000-000000000002'
const projectPath = `/project/${projectId}`
const inviteToken = createProjectInviteCapability({
  projectId,
  secret: 'e2e-private-invite-signing-secret',
  lifetimeMs: 60 * 60 * 1000,
})

test('private project metadata requires a valid scoped invitation capability', async ({ page }) => {
  await page.goto(projectPath)
  await expect(page.getByRole('heading', { name: 'Private invitation' })).toBeVisible()
  await expect(page.getByText('Private browser regression project')).toHaveCount(0)
  await expect(page.getByText('Invite-safe project description')).toHaveCount(0)
  await expect(page.locator('[data-private-project-content="true"]')).toHaveCount(0)

  await page.goto(`${projectPath}?invite=${encodeURIComponent(inviteToken)}`)
  await expect(page.getByRole('heading', { name: 'Private browser regression project' })).toBeVisible()
  await expect(page.getByText('Invite-safe project description')).toBeVisible()
  await expect(page.locator('[data-private-project-content="true"]')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', /invite%3Dv1/)

  await page.goto(`${projectPath}?invite=${encodeURIComponent(`${inviteToken.slice(0, -1)}x`)}`)
  await expect(page.getByRole('heading', { name: 'Private invitation' })).toBeVisible()
  await expect(page.getByText('Private browser regression project')).toHaveCount(0)

  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Private browser regression project' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Private browser regression project' })).toBeVisible()

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})
