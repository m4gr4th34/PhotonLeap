import fs from 'fs'
import path from 'path'
import { test, expect } from '@playwright/test'

function findLensxFiles(dir: string): string[] {
  const files: string[] = []
  try {
    if (!fs.existsSync(dir)) return files
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.lensx')) {
        files.push(path.join(dir, e.name))
      }
    }
  } catch {
    // ignore read errors
  }
  return files
}

test.describe('Lens-X Round-Trip', () => {
  test.afterAll(() => {
    console.log('Cleaning up temporary Lens-X files...')
    const root = process.cwd()
    const testResults = path.join(root, 'test-results')
    for (const dir of [root, testResults]) {
      for (const file of findLensxFiles(dir)) {
        try {
          fs.unlinkSync(file)
        } catch {
          // file may be gone or locked; ignore
        }
      }
    }
  })

  test('export and re-import preserves radius and coating', async ({ page }) => {
    await page.goto('/')

    // Wait for Pyodide boot overlay to disappear (when VITE_USE_PYODIDE=true)
    await expect(page.getByText(/Initializing WebAssembly|Downloading Optical|Establishing Local|Photon Leap/)).not.toBeVisible({ timeout: 60000 })

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
    // Clear the search filter (opens with current value "Uncoated", which hides BBAR)
    await page.getByPlaceholder('Search coatings...').fill('')
    await page.getByTestId('coating-option-BBAR').click()

    // 3. Navigate to Export and click Download LENS-X JSON
    await page.getByTestId('nav-export').click()
    const downloadPromise = page.waitForEvent('download')
    await page.getByTestId('export-lensx-json').click()
    const download = await downloadPromise
    const outDir = path.join(process.cwd(), 'test-results')
    fs.mkdirSync(outDir, { recursive: true })
    const downloadPath = path.join(outDir, `roundtrip-${Date.now()}.lensx`)
    await download.saveAs(downloadPath)

    // 4. Load the exported file to "re-import"
    await page.getByTestId('nav-system').click()
    await page.getByTestId('load-project').click()
    await page.getByTestId('load-project-input').setInputFiles(downloadPath)
    await expect(page.getByTestId('load-confirm-proceed')).toBeVisible()
    await page.getByTestId('load-confirm-proceed').click()

    // 5. Wait for modal to close and state to update
    await expect(page.getByTestId('load-confirm-proceed')).not.toBeVisible({ timeout: 5000 })

    // 6. Verify radius and coating are identical (wait for UI to reflect imported state)
    const radiusInputAfter = page.getByTestId('surface-0-radius')
    await expect(radiusInputAfter).toHaveValue('100', { timeout: 10000 })
    const coatingCell = page.getByTestId('surface-0-coating-cell')
    await expect(coatingCell.locator('input')).toHaveValue('BBAR', { timeout: 5000 })
  })
})
