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

export type CoatingLibraryItem = CoatingOption & {
  category: string
  source: 'builtin' | 'custom'
}

export type CustomCoatingCreate = {
  name: string
  category?: string
  data_type: 'constant' | 'table'
  constant_value?: number
  data_points?: { wavelength: number; reflectivity: number }[]
  description?: string
  is_hr?: boolean
}

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

/** Fallback library when API unavailable (e.g. CI, offline) — ensures catalog has BBAR and common coatings */
const LIBRARY_FALLBACK: CoatingLibraryItem[] = COATINGS_FALLBACK.map((c) => ({
  ...c,
  category: c.is_hr ? 'HR' : 'AR',
  source: 'builtin' as const,
}))

/** Fetch full library with category and source (built-in vs custom) */
export async function fetchCoatingsLibrary(): Promise<CoatingLibraryItem[]> {
  try {
    const res = await fetch(`${API_BASE}/api/coatings/library`)
    if (!res.ok) return LIBRARY_FALLBACK
    const data = await res.json()
    if (!Array.isArray(data)) return LIBRARY_FALLBACK
    const mapped = data.map((c: { name?: string; description?: string; is_hr?: boolean; category?: string; source?: string }) => ({
      name: c.name ?? '',
      description: c.description ?? '',
      is_hr: c.is_hr ?? false,
      category: c.category ?? 'Custom',
      source: (c.source === 'custom' ? 'custom' : 'builtin') as 'builtin' | 'custom',
    }))
    return mapped.length > 0 ? mapped : LIBRARY_FALLBACK
  } catch {
    return LIBRARY_FALLBACK
  }
}

export type CoatingDefinition = {
  name: string
  data_type: 'constant' | 'table'
  constant_value?: number
  data_points?: ReflectivityPoint[]
  is_hr?: boolean
}

/** Fetch full definition for a custom coating (for Lens-X export portability) */
export async function fetchCoatingDefinition(coatingName: string): Promise<CoatingDefinition | null> {
  try {
    const res = await fetch(`${API_BASE}/api/coatings/${encodeURIComponent(coatingName)}/definition`)
    if (!res.ok) return null
    const data = await res.json()
    return {
      name: data.name ?? coatingName,
      data_type: data.data_type ?? 'constant',
      constant_value: data.constant_value,
      data_points: data.data_points,
      is_hr: data.is_hr ?? false,
    }
  } catch {
    return null
  }
}

/** Save a new user-defined coating */
export async function createCustomCoating(coating: CustomCoatingCreate): Promise<CoatingOption> {
  const res = await fetch(`${API_BASE}/api/coatings/custom`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(coating),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || 'Failed to create coating')
  }
  const data = await res.json()
  return {
    name: data.name ?? '',
    description: data.description ?? '',
    is_hr: data.type === 'HR',
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
