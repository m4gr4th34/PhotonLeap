/**
 * LENS-X Standard: Optical lens interchange format.
 * Schema for export/import with physics (Sellmeier), geometry (SVG), and manufacturing data.
 *
 * DEVELOPER NOTE: Before making changes to export logic, read LENS_X_SPEC.md
 * in the project root. It is the ground truth for the Lens-X schema.
 */

import type { Surface } from '../types/system'
import { config } from '../config'
import { generateIso10110Svg } from './iso10110_blueprint'
export { getISOString } from './iso10110'

/** Valid LENS-X version strings */
const VALID_LENS_X_VERSIONS = ['1.0']

/** Per-surface Monte Carlo tolerances — always emitted for engine compatibility */
export interface LensXTolerances {
  radius_tol: number
  thickness_tol: number
  decenter_x: number
  decenter_y: number
  tilt_x: number
  tilt_y: number
  index_tol: number
}

/** LENS-X surface with physics, manufacturing, and tolerances */
export interface LensXSurface {
  /** Radius (mm) or "infinity" for plano */
  radius: number | 'infinity'
  thickness: number
  aperture: number
  material: string
  type?: 'Glass' | 'Air'
  description?: string
  /** Semantic name for Dual-Purpose Lattice (e.g. Primary_Objective) */
  semantic_name?: string
  /** AI-Context: reason for surface (e.g. Corrects coma from S1) */
  ai_context?: string
  physics?: {
    sellmeier?: { B: number[]; C: number[] }
    refractive_index?: number
    coating?: string
    /** Inline R(λ) table for custom coatings — full portability when recipient lacks local library */
    coating_r_table?: { wavelength: number; reflectivity: number }[]
    /** Inline constant R for custom coatings */
    coating_constant_r?: number
    /** Whether custom coating is HR (reflects) vs AR (transmits) */
    coating_is_hr?: boolean
  }
  manufacturing?: {
    surface_quality?: string
    radius_tolerance?: number
    thickness_tolerance?: number
    tilt_tolerance?: number
  }
  /** Monte Carlo tolerances — always present, explicit 0 for omitted values */
  tolerances: LensXTolerances
}

/** Global Monte Carlo settings — always emitted for engine compatibility */
export interface LensXSystemSettings {
  mc_iterations: number
  mc_seed: number
  target_yield: number
}

/** LENS-X document schema */
export interface LensXDocument {
  lens_x_version: string
  metadata?: {
    project_name?: string
    date?: string
    drawn_by?: string
  }
  /** Global Monte Carlo settings — always present */
  system_settings: LensXSystemSettings
  optics: {
    surfaces: LensXSurface[]
    entrance_pupil_diameter: number
    reference_wavelength_nm: number
  }
  geometry?: {
    svg_path: string
  }
}

/**
 * Generate LENS-X JSON from system state.
 * Full state serialization: always emits tolerances and system_settings with explicit values
 * (0 for omitted) so the Monte Carlo engine has a complete structure on reload.
 */
export type CustomCoatingData = Record<
  string,
  { data_type: 'constant' | 'table'; constant_value?: number; data_points?: { wavelength: number; reflectivity: number }[]; is_hr?: boolean }
>

export function toLensX(
  surfaces: Surface[],
  options: {
    projectName?: string
    date?: string
    drawnBy?: string
    entrancePupilDiameter?: number
    referenceWavelengthNm?: number
    mcIterations?: number
    mcSeed?: number
    targetYield?: number
    width?: number
    height?: number
    /** Custom coating definitions for surfaces using custom coatings — embeds R(λ) for portability */
    customCoatingData?: CustomCoatingData
  } = {}
): LensXDocument {
  const {
    projectName = 'Untitled',
    date = new Date().toISOString().slice(0, 10),
    drawnBy = 'MacOptics',
    entrancePupilDiameter = 10,
    referenceWavelengthNm = 587.6,
    mcIterations = 1000,
    mcSeed = 42,
    targetYield = 0.95,
    width = 800,
    height = 570,
    customCoatingData = {},
  } = options

  const lensSurfaces: LensXSurface[] = surfaces.map((s) => {
    const physics: LensXSurface['physics'] = {}
    if (s.refractiveIndex != null) physics.refractive_index = s.refractiveIndex
    if (s.sellmeierCoefficients) physics.sellmeier = s.sellmeierCoefficients
    if (s.coating) physics.coating = s.coating
    // Inline coating data: prefer surface's embedded data (from import), else customCoatingData
    const dataType: 'table' | 'constant' = s.coatingDataPoints != null ? 'table' : 'constant'
    const def = s.coatingDataPoints != null || s.coatingConstantValue != null
      ? { data_type: dataType, data_points: s.coatingDataPoints, constant_value: s.coatingConstantValue, is_hr: s.coatingIsHr }
      : s.coating ? customCoatingData[s.coating] : undefined
    if (def) {
      if (def.data_type === 'table' && def.data_points?.length) {
        physics.coating_r_table = def.data_points
      } else if (def.data_type === 'constant' && def.constant_value != null) {
        physics.coating_constant_r = def.constant_value
      }
      if (def.is_hr != null) physics.coating_is_hr = def.is_hr
    }
    const r = s.radius ?? 0
    const isFlat = r === 0 || (typeof r === 'number' && Math.abs(r) < 0.01)
    const tilt = s.tiltTolerance ?? 0
    return {
      radius: isFlat ? 'infinity' : r,
      thickness: s.thickness ?? 0,
      aperture: (s.diameter ?? 25) / 2,
      material: s.material ?? (s.type === 'Air' ? 'Air' : 'N-BK7'),
      type: s.type ?? (s.refractiveIndex > 1.01 ? 'Glass' : 'Air'),
      description: s.description ?? '',
      ...(s.semanticName && { semantic_name: s.semanticName }),
      ...(s.aiContext && { ai_context: s.aiContext }),
      physics: Object.keys(physics).length > 0 ? physics : undefined,
      manufacturing: {
        surface_quality: s.surfaceQuality ?? '3/2',
        radius_tolerance: s.radiusTolerance ?? 0,
        thickness_tolerance: s.thicknessTolerance ?? 0,
        tilt_tolerance: tilt,
      },
      tolerances: {
        radius_tol: s.radiusTolerance ?? 0,
        thickness_tol: s.thicknessTolerance ?? 0,
        decenter_x: s.decenterX ?? 0,
        decenter_y: s.decenterY ?? 0,
        tilt_x: tilt,
        tilt_y: tilt,
        index_tol: 0,
      },
    }
  })

  const refWl = referenceWavelengthNm ?? 587.6
  const svgPreview = generateIso10110Svg(
    {
      surfaces,
      entrancePupilDiameter,
      wavelengths: [refWl],
      fieldAngles: [0],
      numRays: 9,
      focusMode: 'On-Axis',
      m2Factor: 1,
      pulseWidthFs: 100,
      hasTraced: false,
      rmsSpotRadius: 0,
      totalLength: 0,
      fNumber: 0,
      traceResult: null,
      traceError: null,
    } as Parameters<typeof generateIso10110Svg>[0],
    { projectName, date, drawnBy, width, height }
  )

  return {
    lens_x_version: '1.0',
    metadata: { project_name: projectName, date, drawn_by: drawnBy },
    system_settings: {
      mc_iterations: mcIterations,
      mc_seed: mcSeed,
      target_yield: targetYield,
    },
    optics: {
      surfaces: lensSurfaces,
      entrance_pupil_diameter: entrancePupilDiameter,
      reference_wavelength_nm: refWl,
    },
    geometry: { svg_path: svgPreview },
  }
}

/**
 * Result of parsing a LENS-X file for load.
 */
export interface FromLensXResult {
  surfaces: Surface[]
  entrancePupilDiameter: number
  wavelengths: number[]
  projectName?: string
  mc_iterations?: number
  mc_seed?: number
  target_yield?: number
  /** True if all surfaces had a tolerances block; false if any were missing (defaulted to 0) */
  hasTolerancesData: boolean
}

/**
 * Parse and validate a LENS-X document. Throws if invalid.
 * Converts LENS-X surfaces to internal Surface format.
 */
export function fromLensX(doc: unknown): FromLensXResult {
  if (!doc || typeof doc !== 'object') {
    throw new Error('Invalid LENS-X: expected an object')
  }
  const d = doc as Record<string, unknown>
  const version = d.lens_x_version
  if (typeof version !== 'string' || !VALID_LENS_X_VERSIONS.includes(version)) {
    throw new Error(
      `Invalid LENS-X: missing or unsupported lens_x_version. Expected one of: ${VALID_LENS_X_VERSIONS.join(', ')}`
    )
  }
  const optics = d.optics
  if (!optics || typeof optics !== 'object') {
    throw new Error('Invalid LENS-X: missing optics block')
  }
  const opticsObj = optics as Record<string, unknown>
  const surfacesRaw = opticsObj.surfaces
  if (!Array.isArray(surfacesRaw)) {
    throw new Error('Invalid LENS-X: optics.surfaces must be an array')
  }
  let hasTolerancesData = true
  const surfaces: Surface[] = surfacesRaw.map((raw, idx) => {
    if (!raw || typeof raw !== 'object') {
      throw new Error(`Invalid LENS-X: surface ${idx + 1} is not an object`)
    }
    const s = raw as Record<string, unknown>
    const r = s.radius
    const radius =
      r === 'infinity' || r === 'inf' || r === 'flat' || r === 0
        ? 0
        : typeof r === 'number'
          ? r
          : 0
    const thickness = typeof s.thickness === 'number' ? s.thickness : 0
    const aperture = typeof s.aperture === 'number' ? s.aperture : 12.5
    const diameter = Math.max(0.1, 2 * aperture)
    const material = String(s.material || (s.type === 'Air' ? 'Air' : 'N-BK7')).trim()
    const surfType = String(s.type || 'Glass').trim()
    const isAir = surfType.toLowerCase() === 'air' || material.toLowerCase() === 'air'
    const type = isAir ? 'Air' : 'Glass'
    const physics = (s.physics || {}) as Record<string, unknown>
    const n =
      type === 'Air'
        ? 1
        : (typeof physics.refractive_index === 'number' ? physics.refractive_index : 1.52)
    const mfg = (s.manufacturing || {}) as Record<string, unknown>
    const surf: Surface = {
      id: crypto.randomUUID(),
      type,
      radius,
      thickness,
      refractiveIndex: n,
      diameter,
      material: isAir ? 'Air' : material,
      description: String(s.description || `Surface ${idx + 1}`),
      ...(typeof s.semantic_name === 'string' && s.semantic_name && { semanticName: s.semantic_name }),
      ...(typeof s.ai_context === 'string' && { aiContext: s.ai_context }),
    }
    if (physics.sellmeier && typeof physics.sellmeier === 'object') {
      const sm = physics.sellmeier as { B?: number[]; C?: number[] }
      if (Array.isArray(sm.B) && Array.isArray(sm.C)) {
        surf.sellmeierCoefficients = { B: sm.B, C: sm.C }
      }
    }
    if (physics.coating && typeof physics.coating === 'string') {
      surf.coating = physics.coating.trim()
    }
    if (Array.isArray(physics.coating_r_table) && physics.coating_r_table.length > 0) {
      surf.coatingDataPoints = physics.coating_r_table.map((p: { wavelength?: number; reflectivity?: number }) => ({
        wavelength: Number(p?.wavelength) || 0,
        reflectivity: Number(p?.reflectivity) ?? 0,
      }))
    }
    if (typeof physics.coating_constant_r === 'number') {
      surf.coatingConstantValue = physics.coating_constant_r
    }
    if (typeof physics.coating_is_hr === 'boolean') {
      surf.coatingIsHr = physics.coating_is_hr
    }
    if (mfg.surface_quality) surf.surfaceQuality = String(mfg.surface_quality)
    if (typeof mfg.radius_tolerance === 'number') surf.radiusTolerance = mfg.radius_tolerance
    if (typeof mfg.thickness_tolerance === 'number') surf.thicknessTolerance = mfg.thickness_tolerance
    if (typeof mfg.tilt_tolerance === 'number') surf.tiltTolerance = mfg.tilt_tolerance
    const tol = (s.tolerances || {}) as Record<string, unknown>
    const tolPresent = tol && typeof tol === 'object' && Object.keys(tol).length > 0
    if (!tolPresent) {
      hasTolerancesData = false
      surf.radiusTolerance = surf.radiusTolerance ?? 0
      surf.thicknessTolerance = surf.thicknessTolerance ?? 0
      surf.tiltTolerance = surf.tiltTolerance ?? 0
      surf.decenterX = 0
      surf.decenterY = 0
    } else {
      surf.radiusTolerance = typeof tol.radius_tol === 'number' ? tol.radius_tol : (surf.radiusTolerance ?? 0)
      surf.thicknessTolerance = typeof tol.thickness_tol === 'number' ? tol.thickness_tol : (surf.thicknessTolerance ?? 0)
      surf.tiltTolerance = typeof tol.tilt_x === 'number' ? tol.tilt_x : (typeof tol.tilt_y === 'number' ? tol.tilt_y : (surf.tiltTolerance ?? 0))
      surf.decenterX = typeof tol.decenter_x === 'number' ? tol.decenter_x : 0
      surf.decenterY = typeof tol.decenter_y === 'number' ? tol.decenter_y : 0
    }
    return surf
  })
  const entrancePupilDiameter =
    typeof opticsObj.entrance_pupil_diameter === 'number'
      ? opticsObj.entrance_pupil_diameter
      : config.defaults.entrancePupilDiameter
  const refWl =
    typeof opticsObj.reference_wavelength_nm === 'number'
      ? opticsObj.reference_wavelength_nm
      : config.defaults.defaultWavelength
  const metadata = (d.metadata || {}) as Record<string, unknown>
  const projectName =
    typeof metadata.project_name === 'string' ? metadata.project_name : undefined
  const sysSettings = (d.system_settings || {}) as Record<string, unknown>
  return {
    surfaces,
    entrancePupilDiameter,
    wavelengths: [refWl],
    projectName,
    mc_iterations: typeof sysSettings.mc_iterations === 'number' ? sysSettings.mc_iterations : undefined,
    mc_seed: typeof sysSettings.mc_seed === 'number' ? sysSettings.mc_seed : undefined,
    target_yield: typeof sysSettings.target_yield === 'number' ? sysSettings.target_yield : undefined,
    hasTolerancesData,
  }
}

/**
 * Parse a .lensx file (JSON text). Validates lens_x_version before returning.
 */
export function parseLensXFile(content: string): FromLensXResult {
  let data: unknown
  try {
    data = JSON.parse(content)
  } catch (e) {
    throw new Error(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`)
  }
  return fromLensX(data)
}
