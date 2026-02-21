import { test, expect } from '@playwright/test'

test.describe('PhotonLeap E2E', () => {
  test('app loads', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/Photon Leap|PhotonLeap|lens/i)
  })
})
