/**
 * Pyodide trace engine E2E tests — Zero-Install architecture.
 *
 * These tests verify that the in-browser Pyodide worker performs ray tracing
 * without relying on the HTTP backend. Run with:
 *   VITE_USE_PYODIDE=true npm run dev
 *   npm run test:e2e tests/pyodide-engine.spec.ts
 *
 * Or use the default test:e2e (Playwright config runs dev server with Pyodide env).
 */
import path from 'path'
import { fileURLToPath } from 'url'
import { test, expect } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SINGLET_LENSX = path.join(__dirname, 'fixtures', 'singlet.lensx')

/** Wait for Pyodide boot overlay to disappear (can take 10–30s on first load). */
async function waitForAppReady(page: import('@playwright/test').Page) {
  await expect(page.getByText(/Initializing WebAssembly|Downloading Optical|Establishing Local|\[ READY \]/)).not.toBeVisible({ timeout: 60000 })
}

test.describe('Pyodide Trace Engine', () => {
  test.setTimeout(120000) // Pyodide init + trace can take 60–90s on first load

  test.beforeEach(async ({ page }) => {
    // Abort any HTTP trace API calls — proves Zero-Install engine is doing the work.
    // If the app falls back to the old backend, this will cause the trace to fail.
    await page.route('**/api/trace**', (route) => route.abort())
    await page.route('**/api/trace/**', (route) => route.abort())

    await page.goto('/')
    await waitForAppReady(page)
  })

  test('trace produces rays and surfaces in viewport', async ({ page }) => {
    await page.getByTestId('nav-lens').click()
    await expect(page.locator('svg').first()).toBeVisible({ timeout: 30000 })
    const traceBtn = page.getByRole('button', { name: 'Trace' })
    await expect(traceBtn).toBeVisible({ timeout: 30000 })
    await expect(traceBtn).toBeEnabled({ timeout: 30000 })

    await traceBtn.click()

    // Pyodide init + trace can take several seconds
    await expect(page.getByText(/trace error|cannot reach trace api/i)).not.toBeVisible({ timeout: 15000 })

    const svg = page.locator('svg')
    await expect(svg.first()).toBeVisible({ timeout: 5000 })
    const paths = page.locator('svg path')
    const pathCount = await paths.count()
    expect(pathCount).toBeGreaterThan(0)
  })

  test('load Lens-X, run trace, verify performance metrics', async ({ page }) => {
    test.setTimeout(180000)

    // 1. Load standard singlet Lens-X file
    await page.getByTestId('nav-system').click()
    await expect(page.getByRole('heading', { name: /System Editor/i })).toBeVisible()
    await page.getByTestId('load-project').click()
    await page.getByTestId('load-project-input').setInputFiles(SINGLET_LENSX)
    await expect(page.getByTestId('load-confirm-proceed')).toBeVisible()
    await page.getByTestId('load-confirm-proceed').click()
    await expect(page.getByTestId('load-confirm-proceed')).not.toBeVisible({ timeout: 5000 })

    // 2. Go to Lens tab to trigger auto-trace, then go to Properties — metrics are a more reliable completion signal than button state
    await page.getByTestId('nav-lens').click()
    await expect(page.locator('svg').first()).toBeVisible({ timeout: 30000 })
    await page.getByTestId('nav-properties').click()

    // 3. Wait for Performance section and calculated numeric results (trace completed)
    const perfSection = page.locator('section, .glass-card').filter({ hasText: 'Performance' }).last()
    await expect(perfSection).toBeVisible({ timeout: 90000 })
    await expect(perfSection.getByText('RMS Spot Radius')).toBeVisible({ timeout: 90000 })
    await expect(perfSection.getByText('Total Length')).toBeVisible({ timeout: 90000 })
    await expect(perfSection.getByText('F-Number')).toBeVisible({ timeout: 90000 })

    // 4. Physics validation: ensure numeric values appear (confirms trace finished)
    await expect(perfSection).toContainText(/\d+\.\d+/, { timeout: 90000 })
    const perfContent = await perfSection.textContent()
    expect(perfContent).toMatch(/\d+\.\d+/)

    // 5. Verify no trace error
    await expect(page.getByText(/trace error|cannot reach trace api/i)).not.toBeVisible({ timeout: 5000 })
  })

  test('trace result includes focus and performance metrics', async ({ page }) => {
    await page.getByTestId('nav-lens').click()
    await expect(page.locator('svg').first()).toBeVisible({ timeout: 30000 })
    const traceBtn = page.getByRole('button', { name: 'Trace' })
    await expect(traceBtn).toBeVisible({ timeout: 30000 })
    await expect(traceBtn).toBeEnabled({ timeout: 30000 })

    await traceBtn.click()
    await expect(page.getByText(/trace error|cannot reach trace api/i)).not.toBeVisible({ timeout: 20000 })

    await page.getByTestId('nav-properties').click()
    await expect(page.getByRole('heading', { name: /^Performance$/i })).toBeVisible({ timeout: 5000 })
  })
})

test.describe('Pyodide Trace Engine — Fallback', () => {
  test.setTimeout(30000)

  test.beforeEach(async ({ page }) => {
    await page.route('**/api/trace**', (route) => route.abort())
    await page.route('**/api/trace/**', (route) => route.abort())
    // Intercept worker script with 404 so the Pyodide worker cannot load
    await page.route('**/pyodide/worker.js', (route) => route.fulfill({ status: 404 }))
    await page.goto('/')
  })

  test('graceful state when Pyodide worker fails to load', async ({ page }) => {
    await expect(page.getByText(/Initializing WebAssembly|Downloading Optical|Establishing Local|\[ READY \]/)).not.toBeVisible({ timeout: 15000 })

    await page.getByTestId('nav-lens').click()
    await expect(page.getByTestId('nav-lens')).toHaveClass(/bg-white\/10/, { timeout: 5000 })
    await expect(page.locator('svg').first()).toBeVisible({ timeout: 30000 })

    const traceBtn = page.getByRole('button', { name: 'Trace' })
    await expect(traceBtn).toBeVisible({ timeout: 10000 })
    await expect(traceBtn).toBeEnabled({ timeout: 5000 })
    await traceBtn.click()

    // Trace button becomes disabled and shows 'Tracing…' while hung on missing worker
    await expect(page.getByRole('button', { name: /Tracing|Trace/ })).toBeDisabled()

    // App shows 'Calculating…' while attempting trace
    await expect(page.getByText('Calculating…')).toBeVisible({ timeout: 5000 })
  })
})
