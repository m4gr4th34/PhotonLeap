import { test, expect } from '@playwright/test'

test.describe('MacOptics E2E', () => {
  test('app loads', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/MacOptics|lens/i)
  })
})
