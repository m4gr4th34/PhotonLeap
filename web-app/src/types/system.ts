export type Surface = {
  id: string
  type: 'Glass' | 'Air'
  radius: number
  thickness: number
  refractiveIndex: number
  diameter: number
  material: string
  description: string
  /** Tolerance ± (mm) for Radius — Monte Carlo jitter */
  radiusTolerance?: number
  /** Tolerance ± (mm) for Thickness — Monte Carlo jitter */
  thicknessTolerance?: number
  /** Tolerance ± (degrees) for Tilt — Monte Carlo jitter */
  tiltTolerance?: number
  /** Absorption coefficient (1/cm) for thermal lensing — Glass surfaces only */
  absorptionCoefficient?: number
  /** ISO 10110 surface quality (scratch/dig), e.g. "3/2" */
  surfaceQuality?: string
  /** Sellmeier coefficients { B, C } from LENS-X import — used by trace when material not in library */
  sellmeierCoefficients?: { B: number[]; C: number[] }
  /** Coating (e.g. MgF2, BBAR, V-Coat 532/1064, Protected Silver/Gold/Aluminum, HR) — affects power loss */
  coating?: string
}

export type MetricsAtZ = {
  z: number
  rmsRadius: number | null
  beamWidth: number | null
  chiefRayAngle: number | null
  yCentroid: number | null
  numRays: number
  /** Per-field RMS (mm) — one per field angle, for field-weighted HUD */
  rmsPerField?: (number | null)[]
}

export type GaussianBeam = {
  beamEnvelope: [number, number][]  // [[z, w], ...] — 1/e² radius (mm)
  spotSizeAtFocus: number  // w₀ (mm)
  rayleighRange: number    // z_R (mm)
  waistZ: number
  focusZ: number
}

export type TraceResult = {
  rays: number[][][]
  /** Per-ray field index for correct color mapping (backend provides this) */
  rayFieldIndices?: number[]
  /** Transmitted power (0..1) at end of each ray — P_new = P_old × (1−R(λ)) per surface */
  rayPower?: number[]
  surfaces: number[][][]
  focusZ: number
  bestFocusZ?: number
  zOrigin?: number
  performance?: { rmsSpotRadius: number; totalLength: number; fNumber: number }
  metricsSweep?: MetricsAtZ[]
  /** Physical optics (ABCD Gaussian) beam data */
  gaussianBeam?: GaussianBeam
}

import { config } from '../config'

export type FocusMode = 'On-Axis' | 'Balanced'

export type SystemState = {
  entrancePupilDiameter: number
  wavelengths: number[]
  fieldAngles: number[]
  numRays: number
  focusMode: FocusMode
  m2Factor: number  // Laser M² factor (1.0 = perfect Gaussian)
  pulseWidthFs: number  // Input pulse width (fs) for ultrafast dispersion
  hasTraced: boolean
  surfaces: Surface[]
  // Performance (computed or from trace)
  rmsSpotRadius: number
  totalLength: number
  fNumber: number
  // Backend trace result (z,y coords)
  traceResult: TraceResult | null
  traceError: string | null
  /** Set when surfaces are reordered; triggers trace on next Lens/Info tab view */
  pendingTrace?: boolean
  /** Laser power (W) for thermal lensing — CW high-power */
  laserPowerW?: number
  /** Project name for ISO 10110 export */
  projectName?: string
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
  focusMode: 'On-Axis',
  m2Factor: 1.0,
  pulseWidthFs: 100,
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
