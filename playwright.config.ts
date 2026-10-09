import { defineConfig } from '@playwright/test'

const isCI = Boolean(process.env.CI)
const appUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000'
const supabaseStubUrl = 'http://127.0.0.1:54321'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: [
    [isCI ? 'line' : 'list'],
    ['html', { open: 'never' }],
  ],
  use: {
    baseURL: appUrl,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : [
        {
          command: 'node e2e/support/supabase-stub.mjs',
          url: supabaseStubUrl + '/health',
          reuseExistingServer: !isCI,
          timeout: 30_000,
        },
        {
          command: 'npm run dev -- --hostname 127.0.0.1 --port 3000',
          url: appUrl,
          reuseExistingServer: !isCI,
          timeout: 120_000,
          env: {
            ...process.env,
            NEXT_PUBLIC_SITE_URL: appUrl,
            NEXT_PUBLIC_SUPABASE_URL: supabaseStubUrl,
            NEXT_PUBLIC_SUPABASE_ANON_KEY: 'e2e-anon-key',
            SUPABASE_SERVICE_ROLE: 'e2e-service-role-key',
          },
        },
      ],
  projects: [
    {
      name: 'desktop-chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'mobile-chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
      },
    },
  ],
})
