/**
 * Pyodide trace engine E2E tests.
 *
 * Run with the app in Pyodide mode:
 *   VITE_USE_PYODIDE=true npm run dev
 *   npm run test:e2e tests/pyodide-engine.spec.ts
 *
 * Or use reuseExistingServer and start the dev server manually with Pyodide env.
 */
import { test, expect } from '@playwright/test'

test.describe('Pyodide Trace Engine', () => {
  test('trace produces rays and surfaces in viewport', async ({ page }) => {
    await page.goto('/')

    // Ensure we're on the Lens tab (optical viewport with Trace button)
    await page.getByTestId('nav-lens').click()
    const traceBtn = page.getByRole('button', { name: /trace/i })
    await expect(traceBtn).toBeVisible({ timeout: 10000 })

    // Run trace
    await traceBtn.click()

    // Wait for trace to complete — Pyodide init + trace can take several seconds
    await page.waitForTimeout(4000)

    // Should not show trace error
    await expect(page.getByText(/trace error|cannot reach trace api/i)).not.toBeVisible()

    // Verify trace result: SVG paths for rays/surfaces appear in the main canvas
    const svg = page.locator('svg')
    await expect(svg.first()).toBeVisible({ timeout: 5000 })
    const paths = page.locator('svg path')
    const pathCount = await paths.count()
    expect(pathCount).toBeGreaterThan(0)
  })

  test('trace result includes focus and performance metrics', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('nav-lens').click()
    const traceBtn = page.getByRole('button', { name: /trace/i })
    await traceBtn.click()
    await page.waitForTimeout(4000)

    // After successful trace, HUD or Properties shows focus/RMS/f-number
    await page.getByTestId('nav-properties').click()
    await expect(page.getByText(/focus|rms|spot|f-number|entrance/i)).toBeVisible({ timeout: 5000 })
  })
})
