/**
 * API client for optimize-colors: find second glass to minimize LCA in doublet.
 * When VITE_USE_PYODIDE=true, uses in-browser Pyodide worker (zero-install).
 */

import type { Surface } from '../types/system'
import { config } from '../config'
import { optimizeColorsViaPyodide, isPyodideEnabled } from '../lib/pythonBridge'

export type OptimizeColorsResponse = {
  recommended_glass: string
  estimated_lca_reduction: number
}

const API_BASE = config.apiBaseUrl

function surfaceToPayload(s: Surface) {
  return {
    id: s.id,
    type: s.type,
    radius: s.radius,
    thickness: s.thickness,
    refractiveIndex: s.refractiveIndex,
    diameter: s.diameter,
    material: s.material,
    description: s.description,
  }
}

export async function fetchOptimizeColors(opticalStack: {
  surfaces: Surface[]
  entrancePupilDiameter: number
  wavelengths: number[]
  fieldAngles: number[]
  numRays: number
  focusMode?: string
  m2Factor?: number
}): Promise<OptimizeColorsResponse> {
  if (isPyodideEnabled()) {
    return optimizeColorsViaPyodide({
      surfaces: opticalStack.surfaces,
      entrancePupilDiameter: opticalStack.entrancePupilDiameter,
      wavelengths: opticalStack.wavelengths,
      fieldAngles: opticalStack.fieldAngles,
      numRays: opticalStack.numRays,
      focusMode: opticalStack.focusMode ?? 'On-Axis',
      m2Factor: opticalStack.m2Factor ?? 1.0,
    })
  }
  const payload = {
    surfaces: opticalStack.surfaces.map(surfaceToPayload),
    entrancePupilDiameter: opticalStack.entrancePupilDiameter,
    wavelengths: opticalStack.wavelengths,
    fieldAngles: opticalStack.fieldAngles,
    numRays: opticalStack.numRays,
    focusMode: opticalStack.focusMode ?? 'On-Axis',
    m2Factor: opticalStack.m2Factor ?? 1.0,
  }
  const res = await fetch(`${API_BASE}/api/analysis/optimize-colors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Optimize colors failed: ${res.status}`)
  }
  return res.json()
}
