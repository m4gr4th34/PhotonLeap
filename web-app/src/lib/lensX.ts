/**
 * LENS-X Standard: Optical lens interchange format.
 * Schema for export/import with physics (Sellmeier), geometry (SVG), and manufacturing data.
 */

import type { Surface } from '../types/system'
import { generateIso10110Svg } from './iso10110_blueprint'
export { getISOString } from './iso10110'

/** LENS-X surface with physics and manufacturing data */
export interface LensXSurface {
  radius: number
  thickness: number
  aperture: number
  material: string
  type?: 'Glass' | 'Air'
  description?: string
  physics?: {
    sellmeier?: { B: number[]; C: number[] }
    refractive_index?: number
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
    width?: number
    height?: number
  } = {}
): LensXDocument {
  const {
    projectName = 'Untitled',
    date = new Date().toISOString().slice(0, 10),
    drawnBy = 'MacOptics',
    entrancePupilDiameter = 10,
    width = 800,
    height = 570,
  } = options

  const lensSurfaces: LensXSurface[] = surfaces.map((s) => ({
    radius: s.radius ?? 0,
    thickness: s.thickness ?? 0,
    aperture: (s.diameter ?? 25) / 2,
    material: s.material ?? (s.type === 'Air' ? 'Air' : 'N-BK7'),
    type: s.type ?? (s.refractiveIndex > 1.01 ? 'Glass' : 'Air'),
    description: s.description ?? '',
    physics: s.refractiveIndex != null ? { refractive_index: s.refractiveIndex } : undefined,
    manufacturing: {
      surface_quality: s.surfaceQuality ?? '3/2',
      radius_tolerance: s.radiusTolerance,
      thickness_tolerance: s.thicknessTolerance,
      tilt_tolerance: s.tiltTolerance,
    },
  }))

  const svgPreview = generateIso10110Svg(
    {
      surfaces,
      entrancePupilDiameter,
      wavelengths: [587.6],
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
    },
    geometry: { svg_path: svgPreview },
  }
}
