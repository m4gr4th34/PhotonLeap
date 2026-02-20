import { test, expect } from '@playwright/test'

test.describe('Coating Lab', () => {
  test('BBAR selection shows Spectral Performance graph', async ({ page }) => {
    await page.goto('/')

    // 1. Navigate to Coating Lab
    await page.getByTestId('nav-coating').click()
    await expect(page.getByRole('heading', { name: /Coating Lab/i })).toBeVisible()

    // 2. Open catalog and select BBAR
    await page.getByTestId('coating-browse-catalog').click()
    await page.waitForTimeout(500)
    await page.waitForLoadState('networkidle')
    const content = await page.content()
    console.log('DOM Snapshot:', content.includes('BBAR') ? 'BBAR found in text' : 'BBAR NOT found in text')
    await expect(page.getByTestId('coating-catalog-BBAR')).toBeVisible({ timeout: 10000 })
    await page.getByTestId('coating-catalog-BBAR').click({ timeout: 15000 })

    // 3. Verify Spectral Performance graph is visible with BBAR data
    const spectralGraph = page.getByTestId('spectral-performance-graph')
    await expect(spectralGraph).toBeVisible()
    await expect(spectralGraph.getByText('Showing:')).toBeVisible()
    await expect(spectralGraph.getByText('BBAR')).toBeVisible()
  })
})
