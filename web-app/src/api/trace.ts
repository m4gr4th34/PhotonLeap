/**
 * API client for optical trace backend.
 * Sends optical_stack, receives (z,y) ray and surface coordinates.
 * Surface shape matches types/system.Surface (single source of truth).
 */

import type { Surface, FocusMode } from '../types/system'
import { config } from '../config'

export type TraceResponse = {
  rays?: number[][][]  // [[[z,y], ...], ...] per ray
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
}): Promise<TraceResponse> {
  const payload = {
    ...optical_stack,
    focusMode: optical_stack.focusMode ?? 'On-Axis',
    surfaces: optical_stack.surfaces.map((s) => ({
      id: s.id,
      type: s.type,
      radius: s.radius,
      thickness: s.thickness,
      refractiveIndex: s.refractiveIndex,
      diameter: s.diameter,
      material: s.material,
      description: s.description,
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
