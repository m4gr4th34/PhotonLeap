import { test, expect } from '@playwright/test'

test.describe('Monte Carlo', () => {
  test('changing Tilt in System Editor updates the input value', async ({ page }) => {
    await page.goto('/')

    // 1. Navigate to System Editor
    await page.getByTestId('nav-system').click()
    await expect(page.getByRole('heading', { name: /System Editor/i })).toBeVisible()

    // 2. Set Tilt tolerance for first surface to 0.5
    const tiltInput = page.getByTestId('surface-0-tilt')
    await tiltInput.click()
    await tiltInput.fill('0.5')
    await tiltInput.blur()

    // 3. Verify the Tilt input retains the value (Monte Carlo uses these tolerances)
    await expect(tiltInput).toHaveValue('0.5')

    // 4. Navigate to Info tab (User Guide) and expand Monte Carlo section
    await page.getByTestId('nav-info').click()
    await page.getByRole('button', { name: /Manufacturing Reliability \(Monte Carlo\)/i }).click()

    // 5. Verify Monte Carlo section mentions Tilt± tolerances
    await expect(page.getByText(/Set R±, T±, and Tilt± tolerances in the System Editor/i)).toBeVisible()

    // 6. Navigate back to System Editor and verify tilt value persists
    await page.getByTestId('nav-system').click()
    await expect(page.getByTestId('surface-0-tilt')).toHaveValue('0.5')
  })
})
