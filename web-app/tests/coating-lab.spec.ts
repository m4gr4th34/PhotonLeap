import { test, expect } from '@playwright/test'

test.describe('Coating Lab', () => {
  test('BBAR selection shows Spectral Performance graph', async ({ page }) => {
    await page.goto('/')

    // 1. Navigate to Coating Lab
    await page.getByTestId('nav-coating').click()
    await expect(page.getByRole('heading', { name: /Coating Lab/i })).toBeVisible()

    // 2. Open catalog and select BBAR
    await page.getByTestId('coating-browse-catalog').click()
    await page.getByTestId('coating-catalog-BBAR').click()

    // 3. Verify Spectral Performance graph is visible with BBAR data
    const spectralGraph = page.getByTestId('spectral-performance-graph')
    await expect(spectralGraph).toBeVisible()
    await expect(spectralGraph.getByText('Showing:')).toBeVisible()
    await expect(spectralGraph.getByText('BBAR')).toBeVisible()
  })
})
