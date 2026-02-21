/**
 * API client for chromatic focus shift analysis.
 * Returns focus_shift (BFL in mm) vs wavelength for dispersion visualization.
 * When VITE_USE_PYODIDE=true, uses in-browser Pyodide worker (zero-install).
 */

import type { Surface } from '../types/system'
import { config } from '../config'
import { chromaticShiftViaPyodide, isPyodideEnabled } from '../lib/pythonBridge'

export type ChromaticShiftPoint = {
  wavelength: number
  focus_shift: number
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

export async function fetchChromaticShift(
  opticalStack: {
    surfaces: Surface[]
    entrancePupilDiameter: number
    wavelengths: number[]
    fieldAngles: number[]
    numRays: number
    focusMode?: string
    m2Factor?: number
  },
  options?: {
    wavelengthMinNm?: number
    wavelengthMaxNm?: number
    wavelengthStepNm?: number
  }
): Promise<ChromaticShiftPoint[]> {
  if (isPyodideEnabled()) {
    return chromaticShiftViaPyodide({
      ...opticalStack,
      wavelength_min_nm: options?.wavelengthMinNm ?? 400,
      wavelength_max_nm: options?.wavelengthMaxNm ?? 1100,
      wavelength_step_nm: options?.wavelengthStepNm ?? 10,
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
    wavelength_min_nm: options?.wavelengthMinNm ?? 400,
    wavelength_max_nm: options?.wavelengthMaxNm ?? 1100,
    wavelength_step_nm: options?.wavelengthStepNm ?? 10,
  }
  const res = await fetch(`${API_BASE}/api/analysis/chromatic-shift`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Chromatic shift failed: ${res.status}`)
  }
  return res.json()
}
