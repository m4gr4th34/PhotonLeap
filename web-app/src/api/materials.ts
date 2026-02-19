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

/** Compute n at 587.6 nm from Sellmeier coefficients (λ in µm). */
function nFromCoeffs(lambdaNm: number, coeffs: Record<string, unknown>): number {
  const B = coeffs.B as number[] | undefined
  const C = coeffs.C as number[] | undefined
  if (!B || !C || B.length < 3 || C.length < 3) {
    const n = coeffs.n as number | undefined
    return typeof n === 'number' ? n : 1.5
  }
  const lam = lambdaNm * 1e-3
  const lam2 = lam * lam
  let n2 = 1
  for (let i = 0; i < 3; i++) {
    n2 += (B[i] * lam2) / (lam2 - C[i])
  }
  return Math.sqrt(Math.max(n2, 1))
}

export type MaterialOption = { name: string; n: number }

/** Fetch materials from backend; returns { name, n } for dropdown. Falls back to default list on error. */
export async function fetchMaterials(): Promise<MaterialOption[]> {
  const DEFAULT: MaterialOption[] = [
    { name: 'Air', n: 1 },
    { name: 'N-BK7', n: 1.5168 },
    { name: 'Fused Silica', n: 1.458 },
    { name: 'N-SF11', n: 1.78472 },
    { name: 'N-SF5', n: 1.6727 },
  ]
  try {
    const res = await fetch(`${API_BASE}/api/materials`)
    if (!res.ok) return DEFAULT
    const data = (await res.json()) as GlassMaterial[]
    const wvl = 587.6
    return data.map((m) => ({
      name: m.name,
      n: nFromCoeffs(wvl, m.coefficients || {}),
    }))
  } catch {
    return DEFAULT
  }
}
