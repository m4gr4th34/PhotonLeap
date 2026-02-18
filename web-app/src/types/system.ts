export type Surface = {
  id: string
  type: 'Glass' | 'Air'
  radius: number
  thickness: number
  refractiveIndex: number
}

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
}

/** Compute performance metrics from system state (simplified paraxial model) */
export function computePerformance(state: SystemState): Pick<
  SystemState,
  'rmsSpotRadius' | 'totalLength' | 'fNumber'
> {
  const totalLength = state.surfaces.reduce((sum, s) => sum + s.thickness, 0)
  // Paraxial EFL approx for thin lens: 1/f = (n-1)(1/R1 - 1/R2)
  const s0 = state.surfaces[0]
  const s1 = state.surfaces[1]
  const efl =
    s0 && s1 && s0.radius !== 0 && s1.radius !== 0
      ? 1 / ((s0.refractiveIndex - 1) * (1 / s0.radius - 1 / -s1.radius))
      : 100
  const fNumber = state.entrancePupilDiameter > 0 ? efl / state.entrancePupilDiameter : 0
  // RMS spot: rough estimate from field angles
  const rmsSpotRadius =
    state.fieldAngles.length > 0
      ? 0.01 * Math.sqrt(state.fieldAngles.reduce((s, a) => s + a * a, 0) / state.fieldAngles.length)
      : 0
  return { rmsSpotRadius, totalLength, fNumber }
}

export const DEFAULT_SYSTEM_STATE: SystemState = {
  entrancePupilDiameter: 10,
  wavelengths: [587.6, 486.1, 656.3],
  fieldAngles: [0, 7, 14],
  numRays: 9,
  hasTraced: false,
  surfaces: [
    { id: '1', type: 'Glass', radius: 100, thickness: 5, refractiveIndex: 1.5168 },
    { id: '2', type: 'Air', radius: -100, thickness: 95, refractiveIndex: 1 },
  ],
  rmsSpotRadius: 0,
  totalLength: 100,
  fNumber: 10,
}
