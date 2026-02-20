/**
 * API client for optical trace backend.
 * Sends optical_stack, receives (z,y) ray and surface coordinates.
 * When VITE_USE_PYODIDE=true, uses in-browser Pyodide worker (zero-install).
 * Otherwise uses HTTP backend.
 */

import type { Surface, FocusMode } from '../types/system'
import { config } from '../config'
import { traceViaPyodide, isPyodideEnabled } from '../lib/pythonBridge'

export type TraceResponse = {
  rays?: number[][][]  // [[[z,y], ...], ...] per ray
  rayFieldIndices?: number[]  // field index per ray for correct color mapping
  rayPower?: number[]  // transmitted power (0..1) at end of each ray
  surfaces?: number[][][]  // [[[z,y], ...], ...] per surface curve
  focusZ?: number
  bestFocusZ?: number
  zOrigin?: number
  performance?: {
    rmsSpotRadius: number
    totalLength: number
    fNumber: number
  }
  metricsSweep?: Array<{
    z: number
    rmsRadius: number | null
    beamWidth: number | null
    chiefRayAngle: number | null
    yCentroid: number | null
    numRays: number
    rmsPerField?: (number | null)[]
  }>
  gaussianBeam?: {
    beamEnvelope: [number, number][]
    spotSizeAtFocus: number
    rayleighRange: number
    waistZ: number
    focusZ: number
  }
  /** Pyodide: ray termination reasons for debugging (TIR, MISSED_SURFACE, etc.) */
  terminationLog?: Array<{
    reason: string
    surf: number
    z: number
    y: number
    direction_vector?: [number, number]
    current_z?: number
    n1?: number
    n2?: number
    resultant?: [number, number]
    wvl_nm?: number
    extra?: Record<string, unknown>
  }>
  error?: string
}

const API_BASE = config.apiBaseUrl

export async function traceOpticalStack(optical_stack: {
  surfaces: Surface[]
  entrancePupilDiameter: number
  wavelengths: number[]
  fieldAngles: number[]
  numRays: number
  focusMode?: FocusMode
  m2Factor?: number
}): Promise<TraceResponse> {
  if (isPyodideEnabled()) {
    return traceViaPyodide(optical_stack)
  }
  const payload = {
    ...optical_stack,
    focusMode: optical_stack.focusMode ?? 'On-Axis',
    m2Factor: optical_stack.m2Factor ?? 1.0,
    surfaces: optical_stack.surfaces.map((s) => ({
      id: s.id,
      type: s.type,
      radius: s.radius,
      thickness: s.thickness,
      refractiveIndex: s.refractiveIndex,
      diameter: s.diameter,
      material: s.material,
      description: s.description,
      coating: s.coating,
      coating_r_table: s.coatingDataPoints ?? undefined,
      coating_constant_r: s.coatingConstantValue ?? undefined,
      coating_is_hr: s.coatingIsHr ?? undefined,
    })),
  }
  const res = await fetch(`${API_BASE}/api/trace`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Trace failed: ${res.status}`)
  }
  return res.json()
}

export type MonteCarloResponse = {
  spots?: [number, number][]  // [x, y] in mm at image plane
  focusZ?: number
  imagePlaneZ?: number
  rmsSpread?: number
  numValid?: number
  error?: string
  /** Per-surface RMS when that surface alone is jittered (sensitivity heatmap) */
  sensitivityBySurface?: number[]
}

export async function runMonteCarlo(optical_stack: {
  surfaces: Surface[]
  entrancePupilDiameter: number
  wavelengths: number[]
  fieldAngles: number[]
  numRays: number
  focusMode?: FocusMode
  iterations?: number
}): Promise<MonteCarloResponse> {
  const payload = {
    ...optical_stack,
    focusMode: optical_stack.focusMode ?? 'On-Axis',
    iterations: optical_stack.iterations,
    surfaces: optical_stack.surfaces.map((s) => ({
      id: s.id,
      type: s.type,
      radius: s.radius,
      thickness: s.thickness,
      refractiveIndex: s.refractiveIndex,
      diameter: s.diameter,
      material: s.material,
      description: s.description,
      radiusTolerance: s.radiusTolerance ?? 0,
      thicknessTolerance: s.thicknessTolerance ?? 0,
      tiltTolerance: s.tiltTolerance ?? 0,
      decenterX: s.decenterX ?? 0,
      decenterY: s.decenterY ?? 0,
      coating: s.coating,
      coating_r_table: s.coatingDataPoints ?? undefined,
      coating_constant_r: s.coatingConstantValue ?? undefined,
      coating_is_hr: s.coatingIsHr ?? undefined,
    })),
  }
  const res = await fetch(`${API_BASE}/api/monte-carlo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Monte Carlo failed: ${res.status}`)
  }
  return res.json()
}
