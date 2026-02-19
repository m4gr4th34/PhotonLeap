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

/** LENS-X surface with physics and manufacturing data */
export interface LensXSurface {
  /** Radius (mm) or "infinity" for plano */
  radius: number | 'infinity'
  thickness: number
  aperture: number
  material: string
  type?: 'Glass' | 'Air'
  description?: string
  physics?: {
    sellmeier?: { B: number[]; C: number[] }
    refractive_index?: number
    coating?: string
  }
  manufacturing?: {
    surface_quality?: string
    radius_tolerance?: number
    thickness_tolerance?: number
    tilt_tolerance?: number
  }
}

/** LENS-X document schema */
export interface LensXDocument {
  lens_x_version: string
  metadata?: {
    project_name?: string
    date?: string
    drawn_by?: string
  }
  optics: {
    surfaces: LensXSurface[]
    entrance_pupil_diameter?: number
    reference_wavelength_nm?: number
  }
  geometry?: {
    svg_path: string
  }
}

/**
 * Generate LENS-X JSON from system state.
 * Ensures radius, thickness, aperture for every surface.
 */
export function toLensX(
  surfaces: Surface[],
  options: {
    projectName?: string
    date?: string
    drawnBy?: string
    entrancePupilDiameter?: number
    referenceWavelengthNm?: number
    width?: number
    height?: number
  } = {}
): LensXDocument {
  const {
    projectName = 'Untitled',
    date = new Date().toISOString().slice(0, 10),
    drawnBy = 'MacOptics',
    entrancePupilDiameter = 10,
    referenceWavelengthNm,
    width = 800,
    height = 570,
  } = options

  const lensSurfaces: LensXSurface[] = surfaces.map((s) => {
    const physics: LensXSurface['physics'] = {}
    if (s.refractiveIndex != null) physics.refractive_index = s.refractiveIndex
    if (s.sellmeierCoefficients) physics.sellmeier = s.sellmeierCoefficients
    if (s.coating) physics.coating = s.coating
    const r = s.radius ?? 0
    const isFlat = r === 0 || (typeof r === 'number' && Math.abs(r) < 0.01)
    return {
      radius: isFlat ? 'infinity' : r,
      thickness: s.thickness ?? 0,
      aperture: (s.diameter ?? 25) / 2,
      material: s.material ?? (s.type === 'Air' ? 'Air' : 'N-BK7'),
      type: s.type ?? (s.refractiveIndex > 1.01 ? 'Glass' : 'Air'),
      description: s.description ?? '',
      physics: Object.keys(physics).length > 0 ? physics : undefined,
      manufacturing: {
        surface_quality: s.surfaceQuality ?? '3/2',
        radius_tolerance: s.radiusTolerance,
        thickness_tolerance: s.thicknessTolerance,
        tilt_tolerance: s.tiltTolerance,
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
    optics: {
      surfaces: lensSurfaces,
      entrance_pupil_diameter: entrancePupilDiameter,
      ...(referenceWavelengthNm != null && { reference_wavelength_nm: referenceWavelengthNm }),
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
    if (mfg.surface_quality) surf.surfaceQuality = String(mfg.surface_quality)
    if (typeof mfg.radius_tolerance === 'number') surf.radiusTolerance = mfg.radius_tolerance
    if (typeof mfg.thickness_tolerance === 'number') surf.thicknessTolerance = mfg.thickness_tolerance
    if (typeof mfg.tilt_tolerance === 'number') surf.tiltTolerance = mfg.tilt_tolerance
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
  return {
    surfaces,
    entrancePupilDiameter,
    wavelengths: [refWl],
    projectName,
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
