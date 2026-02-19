/**
 * Fetches optical coatings from GET /api/coatings for the surface coating dropdown.
 */

import { config } from '../config'

export type CoatingOption = {
  name: string
  description: string
  is_hr: boolean
}

const API_BASE = config.apiBaseUrl

/** Swatch color for coating visual indicator (CSS circle, gold for Gold, light blue for AR) */
export function getCoatingSwatchStyle(name: string): { background: string } {
  const m: Record<string, { background: string }> = {
    Uncoated: { background: '#94a3b8' },
    None: { background: '#94a3b8' },
    MgF2: { background: '#7dd3fc' },
    BBAR: { background: '#93c5fd' },
    'V-Coat 532': { background: '#a5b4fc' },
    'V-Coat 1064': { background: '#67e8f9' },
    'Protected Silver': { background: 'linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 50%, #94a3b8 100%)' },
    'Protected Gold': { background: 'linear-gradient(135deg, #fcd34d 0%, #f59e0b 50%, #d97706 100%)' },
    'Protected Aluminum': { background: 'linear-gradient(135deg, #9ca3af 0%, #6b7280 50%, #4b5563 100%)' },
    HR: { background: 'linear-gradient(135deg, #374151 0%, #1f2937 100%)' },
  }
  return m[name] ?? { background: '#64748b' }
}

/** Fallback when API is unavailable */
export const COATINGS_FALLBACK: CoatingOption[] = [
  { name: 'Uncoated', description: 'Uncoated (Fresnel ~4% R for glass)', is_hr: false },
  { name: 'None', description: 'Uncoated (Fresnel ~4%)', is_hr: false },
  { name: 'MgF2', description: 'Single-layer MgF₂ AR coating', is_hr: false },
  { name: 'BBAR', description: 'Broadband anti-reflection (400–700 nm)', is_hr: false },
  { name: 'V-Coat 532', description: 'V-coat optimized for 532 nm', is_hr: false },
  { name: 'V-Coat 1064', description: 'V-coat optimized for 1064 nm', is_hr: false },
  { name: 'Protected Silver', description: 'Protected silver mirror (~97.5% R)', is_hr: false },
  { name: 'Protected Gold', description: 'Protected gold mirror (~98% R)', is_hr: false },
  { name: 'Protected Aluminum', description: 'Protected aluminum mirror (~92% R)', is_hr: false },
  { name: 'HR', description: 'High reflectivity mirror (>99.5%) — reflects instead of refracts', is_hr: true },
]

export async function fetchCoatings(): Promise<CoatingOption[]> {
  try {
    const res = await fetch(`${API_BASE}/api/coatings`)
    if (!res.ok) return COATINGS_FALLBACK
    const data = await res.json()
    if (!Array.isArray(data)) return COATINGS_FALLBACK
    return data.map((c: { name?: string; description?: string; is_hr?: boolean }) => ({
      name: c.name ?? '',
      description: c.description ?? '',
      is_hr: c.is_hr ?? false,
    }))
  } catch {
    return COATINGS_FALLBACK
  }
}

export type ReflectivityPoint = { wavelength: number; reflectivity: number }

/** Fetch R(λ) curve from backend. Falls back to approximate formulas when API unavailable. */
export async function fetchReflectivityCurve(
  coatingName: string,
  minNm: number,
  maxNm: number,
  stepNm: number = 5
): Promise<ReflectivityPoint[]> {
  try {
    const params = new URLSearchParams({
      min_nm: String(minNm),
      max_nm: String(maxNm),
      step_nm: String(stepNm),
    })
    const res = await fetch(`${API_BASE}/api/coatings/${encodeURIComponent(coatingName)}/reflectivity?${params}`)
    if (!res.ok) throw new Error('Failed to fetch')
    const data = await res.json()
    const pts = data?.points
    if (!Array.isArray(pts)) throw new Error('Invalid response')
    return pts.map((p: { wavelength?: number; reflectivity?: number }) => ({
      wavelength: Number(p.wavelength) || 0,
      reflectivity: Number(p.reflectivity) ?? 0,
    }))
  } catch {
    return reflectivityCurveFallback(coatingName, minNm, maxNm, stepNm)
  }
}

/** Approximate R(λ) when API unavailable — matches backend coating_engine formulas */
function reflectivityCurveFallback(
  name: string,
  minNm: number,
  maxNm: number,
  stepNm: number
): ReflectivityPoint[] {
  const points: ReflectivityPoint[] = []
  const rFn = (lam: number): number => {
    switch (name) {
      case 'Uncoated':
      case 'None':
        return 0.04
      case 'MgF2':
        const t = lam / 550
        return 0.013 * (1 + 0.1 * (t - 1) ** 2)
      case 'BBAR':
        return lam >= 400 && lam <= 700 ? 0.004 + 0.001 * Math.abs(lam - 550) / 150 : 0.01
      case 'V-Coat 532':
        return 0.0025 + 0.01 * Math.min(Math.abs(lam - 532) / 50, 1)
      case 'V-Coat 1064':
        return 0.0025 + 0.01 * Math.min(Math.abs(lam - 1064) / 100, 1)
      case 'Protected Silver':
        return 0.975
      case 'Protected Gold':
        return 0.98
      case 'Protected Aluminum':
        return 0.92
      case 'HR':
        return 0.995
      default:
        return 0.04
    }
  }
  for (let w = minNm; w <= maxNm; w += stepNm) {
    points.push({ wavelength: w, reflectivity: rFn(w) })
  }
  return points
}
