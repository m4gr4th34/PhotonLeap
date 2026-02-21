/**
 * API client for material library.
 * Fetches glass materials from /api/materials for the Material dropdown.
 */

import { config } from '../config'

export type GlassMaterial = {
  name: string
  dispersion_formula: string
  coefficients: Record<string, unknown>
}

const API_BASE = config.apiBaseUrl

/**
 * Refractive index from Sellmeier equation.
 * n²(λ) = 1 + B₁λ²/(λ²-C₁) + B₂λ²/(λ²-C₂) + B₃λ²/(λ²-C₃), λ in µm.
 */
export function nFromCoeffs(lambdaNm: number, coeffs: Record<string, unknown>): number {
  const B = coeffs.B as number[] | undefined
  const C = coeffs.C as number[] | undefined
  if (!B || !C || B.length < 3 || C.length < 3) {
    const n = coeffs.n as number | undefined
    return typeof n === 'number' ? n : 1.5
  }
  const lam = lambdaNm * 1e-3 // convert nm → µm
  const lam2 = lam * lam
  let n2 = 1
  for (let i = 0; i < 3; i++) {
    n2 += (B[i] * lam2) / (lam2 - C[i])
  }
  return Math.sqrt(Math.max(n2, 1))
}

export type MaterialOption = { name: string; n: number; coefficients?: Record<string, unknown> }

/** Fetch materials from backend; returns { name, n } for dropdown. Falls back to local glass_library.json when API unavailable (e.g. Pyodide mode). */
export async function fetchMaterials(): Promise<MaterialOption[]> {
  const toOptions = (data: GlassMaterial[]): MaterialOption[] => {
    const wvl = 587.6
    return data.map((m) => ({
      name: m.name,
      n: nFromCoeffs(wvl, m.coefficients || {}),
      coefficients: m.coefficients,
    }))
  }
  try {
    const res = await fetch(`${API_BASE}/api/materials`)
    if (res.ok) {
      const data = (await res.json()) as GlassMaterial[]
      return toOptions(data)
    }
  } catch {
    /* API unavailable, try local fallback */
  }
  try {
    const base = (typeof import.meta !== 'undefined' && (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) || '/'
    const path = base.endsWith('/') ? `${base}glass_library.json` : `${base}/glass_library.json`
    const url = typeof location !== 'undefined' ? new URL(path, location.href).href : path
    const res = await fetch(url)
    if (res.ok) {
      const json = (await res.json()) as { materials?: GlassMaterial[] }
      const data = json.materials || []
      return toOptions(data)
    }
  } catch {
    /* fallback to minimal list */
  }
  return [
    { name: 'Air', n: 1 },
    { name: 'N-BK7', n: 1.5168 },
    { name: 'Fused Silica', n: 1.458 },
    { name: 'N-SF11', n: 1.78472 },
    { name: 'N-SF5', n: 1.6727 },
  ]
}
