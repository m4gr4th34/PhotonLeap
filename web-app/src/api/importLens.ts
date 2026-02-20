/**
 * Import lens system from .json, .lensx, or .svg.
 *
 * For .lensx and LENS-X .json: reads locally via file.text(), parses client-side.
 * No network fetch — avoids Service Worker FetchEvent issues in standalone mode.
 *
 * For .svg (and non-LENS-X .json): uses /api/import/lens-system (requires backend).
 *
 * DEVELOPER NOTE: Before making changes to import logic, read LENS_X_SPEC.md
 * in the project root. It is the ground truth for the Lens-X schema.
 */

import { config } from '../config'
import type { Surface } from '../types/system'
import { parseLensXFile } from '../lib/lensX'
import { isPyodideEnabled } from '../lib/pythonBridge'

const API_BASE = config.apiBaseUrl

export interface ImportLensResponse {
  surfaces: Surface[]
}

/**
 * Import from .lensx or LENS-X .json using FileReader/file.text() — no fetch.
 * Passes raw string to client-side parser. Graceful error handling.
 */
async function importLensXClientSide(file: File): Promise<ImportLensResponse> {
  const content = await file.text()
  try {
    const result = parseLensXFile(content)
    return { surfaces: result.surfaces }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Invalid LENS-X file: ${msg}`)
  }
}

/**
 * Import via backend API (for .svg and Zemax-style .json).
 */
async function importLensSystemViaApi(file: File): Promise<ImportLensResponse> {
  const formData = new FormData()
  formData.append('file', file)

  const res = await fetch(`${API_BASE}/api/import/lens-system`, {
    method: 'POST',
    body: formData,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Import failed (${res.status})`)
  }

  const data = (await res.json()) as ImportLensResponse
  if (!Array.isArray(data.surfaces)) {
    throw new Error('Invalid response: expected surfaces array')
  }
  return data
}

/**
 * Import lens system from file. Uses client-side parsing for .lensx and .json
 * when possible (avoids fetch/Service Worker issues). Falls back to API for .svg
 * and non-LENS-X .json when backend is available.
 */
export async function importLensSystem(file: File): Promise<ImportLensResponse> {
  const ext = (file.name || '').toLowerCase().split('.').pop() ?? ''
  const isLensX = file.name.toLowerCase().endsWith('.lensx')
  const isJson = ext === 'json'
  const isSvg = ext === 'svg'

  if (isLensX || isJson) {
    try {
      return await importLensXClientSide(file)
    } catch (err) {
      if (isPyodideEnabled()) {
        throw err
      }
      try {
        return await importLensSystemViaApi(file)
      } catch {
        throw err
      }
    }
  }

  if (isSvg) {
    if (isPyodideEnabled()) {
      throw new Error('SVG import requires the backend server. Use .lensx or .json for standalone mode.')
    }
    return importLensSystemViaApi(file)
  }

  if (ext === 'csv') {
    if (isPyodideEnabled()) {
      throw new Error('CSV import requires the backend server. Use .lensx or .json for standalone mode.')
    }
    return importLensSystemViaApi(file)
  }

  throw new Error(`Unsupported file type .${ext}. Use .lensx, .json, or .svg.`)
}
