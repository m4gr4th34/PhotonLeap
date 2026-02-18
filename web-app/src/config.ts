/**
 * App configuration — centralizes settings for ray-tracing UI and API.
 * Override via environment variables where applicable.
 */

export const config = {
  /** Trace API base URL (set VITE_API_URL to override) */
  apiBaseUrl: import.meta.env.VITE_API_URL || 'http://localhost:8000',

  /** Optical viewport dimensions (px) */
  viewport: {
    width: 640,
    height: 320,
  },

  /** Ray count slider bounds */
  rayCount: {
    min: 3,
    max: 21,
  },

  /** Default system state values */
  defaults: {
    entrancePupilDiameter: 10,
    wavelengths: [587.6, 486.1, 656.3],
    fieldAngles: [0, 7, 14],
    numRays: 9,
    defaultWavelength: 587.6,
    defaultFieldAngle: 7,
  },

  /** Default new surface values */
  surfaceDefaults: {
    thickness: 10,
    diameter: 25,
    refractiveIndex: 1.0,
  },

  /** View transform / auto-zoom */
  view: {
    padding: 40,
    scaleFactor: 0.9,
    minZExtent: 30,
    extendZFactor: 0.2,
    extendZMin: 50,
  },

  /** Ray colors by field angle (on-axis, mid, edge) */
  rayColors: ['#22D3EE', '#F97316', '#22C55E'] as const,

  /** Paraxial fallback (when backend unavailable) */
  paraxial: {
    focusYFactor: 0.15,
    lensToFocusFactor: 0.3,
  },

  /** Toast duration (ms) */
  toastDuration: 2500,
} as const
