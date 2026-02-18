export type Surface = {
  id: string
  type: 'Glass' | 'Air'
  radius: number
  thickness: number
  refractiveIndex: number
  diameter: number
  material: string
  description: string
}

export type MetricsAtZ = {
  z: number
  rmsRadius: number | null
  beamWidth: number | null
  chiefRayAngle: number | null
  yCentroid: number | null
  numRays: number
}

export type TraceResult = {
  rays: number[][][]
  surfaces: number[][][]
  focusZ: number
  zOrigin?: number
  performance?: { rmsSpotRadius: number; totalLength: number; fNumber: number }
  metricsSweep?: MetricsAtZ[]
}

import { config } from '../config'

export type SystemState = {
  entrancePupilDiameter: number
  wavelengths: number[]
  fieldAngles: number[]
  numRays: number
  hasTraced: boolean
  surfaces: Surface[]
  // Performance (computed or from trace)
  rmsSpotRadius: number
  totalLength: number
  fNumber: number
  // Backend trace result (z,y coords)
  traceResult: TraceResult | null
  traceError: string | null
}

/** Compute performance metrics from system state (prefer trace result when available) */
export function computePerformance(state: SystemState): Pick<
  SystemState,
  'rmsSpotRadius' | 'totalLength' | 'fNumber'
> {
  if (state.traceResult?.performance) {
    const p = state.traceResult.performance
    return { rmsSpotRadius: p.rmsSpotRadius, totalLength: p.totalLength, fNumber: p.fNumber }
  }
  const totalLength = state.surfaces.reduce((sum, s) => sum + s.thickness, 0)
  const s0 = state.surfaces[0]
  const s1 = state.surfaces[1]
  const efl =
    s0 && s1 && s0.radius !== 0 && s1.radius !== 0
      ? 1 / ((s0.refractiveIndex - 1) * (1 / s0.radius - 1 / -s1.radius))
      : 100
  const fNumber = state.entrancePupilDiameter > 0 ? efl / state.entrancePupilDiameter : 0
  const rmsSpotRadius =
    state.fieldAngles.length > 0
      ? 0.01 * Math.sqrt(state.fieldAngles.reduce((s, a) => s + a * a, 0) / state.fieldAngles.length)
      : 0
  return { rmsSpotRadius, totalLength, fNumber }
}

export const DEFAULT_SYSTEM_STATE: SystemState = {
  entrancePupilDiameter: config.defaults.entrancePupilDiameter,
  wavelengths: [...config.defaults.wavelengths],
  fieldAngles: [...config.defaults.fieldAngles],
  numRays: config.defaults.numRays,
  hasTraced: false,
  surfaces: [
    {
      id: crypto.randomUUID(),
      type: 'Glass',
      radius: 100,
      thickness: 5,
      refractiveIndex: 1.5168,
      diameter: 25,
      material: 'N-BK7',
      description: 'Front surface',
    },
    {
      id: crypto.randomUUID(),
      type: 'Air',
      radius: -100,
      thickness: 95,
      refractiveIndex: 1,
      diameter: 25,
      material: 'Air',
      description: 'Back surface',
    },
  ],
  rmsSpotRadius: 0,
  totalLength: 100,
  fNumber: 10,
  traceResult: null,
  traceError: null,
}
