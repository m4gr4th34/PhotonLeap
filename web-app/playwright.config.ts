import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config for MacOptics E2E tests.
 * Chromium headless for CI; test-results for traces and videos.
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  globalTeardown: './tests/global-teardown.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html'],
    ['list'],
    ['json', { outputFile: 'test-results.json' }],
  ],
  use: {
    baseURL: 'http://localhost:5173',
    trace: process.env.CI ? 'retain-on-failure' : 'on-first-retry',
    video: process.env.CI ? 'retain-on-failure' : 'on-first-retry',
  },
  outputDir: 'test-results',
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        headless: true,
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    env: {
      ...(process.env.CI ? { VITE_API_URL: 'http://localhost:8000' } : {}),
      VITE_USE_PYODIDE: 'true',
    },
  },
})
