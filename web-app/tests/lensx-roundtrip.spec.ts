import { test, expect } from '@playwright/test'

test.describe('Lens-X Round-Trip', () => {
  test('export and re-import preserves radius and coating', async ({ page }) => {
    await page.goto('/')

    // 1. Navigate to System Editor
    await page.getByTestId('nav-system').click()
    await expect(page.getByRole('heading', { name: /System Editor/i })).toBeVisible()

    // 2. Edit first surface: radius 100mm, coating BBAR
    const radiusInput = page.getByTestId('surface-0-radius')
    await radiusInput.click()
    await radiusInput.fill('100')
    await radiusInput.blur()

    // Open coating dropdown for first surface and select BBAR
    await page.getByTestId('surface-0-coating-cell').locator('input').click()
    await page.getByTestId('coating-option-BBAR').click()

    // 3. Navigate to Export and click Download LENS-X JSON
    await page.getByTestId('nav-export').click()
    const downloadPromise = page.waitForEvent('download')
    await page.getByTestId('export-lensx-json').click()
    const download = await downloadPromise
    const downloadPath = await download.path()
    expect(downloadPath).toBeTruthy()

    // 4. Load the exported file to "re-import"
    await page.getByTestId('nav-system').click()
    await page.getByTestId('load-project').click()
    await page.getByTestId('load-project-input').setInputFiles(downloadPath!)
    await expect(page.getByTestId('load-confirm-proceed')).toBeVisible()
    await page.getByTestId('load-confirm-proceed').click()

    // 5. Verify radius and coating are identical
    await expect(page.getByTestId('surface-0-radius')).toHaveValue('100')
    const coatingCell = page.getByTestId('surface-0-coating-cell')
    await expect(coatingCell.locator('input')).toHaveValue('BBAR')
  })
})
