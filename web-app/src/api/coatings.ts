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

/** Fallback when API is unavailable */
export const COATINGS_FALLBACK: CoatingOption[] = [
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
