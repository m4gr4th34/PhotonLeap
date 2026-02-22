/**
 * App configuration — centralizes settings for ray-tracing UI and API.
 * Override via environment variables where applicable.
 */

/** Detect Mac platform for keyboard shortcut labels (Option vs Alt) */
export const isMac =
  typeof navigator !== 'undefined' &&
  navigator.platform.toUpperCase().indexOf('MAC') >= 0

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

  /** Maximum field angles allowed (Cyan, Green, Orange) */
  maxFieldAngles: 3,

  /** Ray colors by field angle index: 0 (0°) Cyan, 1 (7°) Green, 2 (14°) Orange */
  rayColors: ['#22D3EE', '#22C55E', '#F97316'] as const,

  /** Paraxial fallback (when backend unavailable) */
  paraxial: {
    focusYFactor: 0.15,
    lensToFocusFactor: 0.3,
  },

  /** Toast duration (ms) */
  toastDuration: 2500,

  /** Thermal lensing: power threshold (W) above which heat map overlay is shown */
  thermalPowerThresholdW: 1,

  /** LLM API keys — loaded from localStorage via AgentKeysContext only. No env fallback. */
  llm: {
    anthropicApiKey: '',
    openaiApiKey: '',
    deepseekApiKey: '',
  },

  /** Agent self-correction: RMS threshold (μm) above which design is considered failed */
  agentRmsThresholdUm: 1000,

  /** Max optical bench length (mm) — designs exceeding this fail Operational check */
  agentMaxBenchSizeMm: 500,

  /** Max lens aspect ratio (diameter/thickness) — > this is too fragile to manufacture */
  agentMaxAspectRatio: 20,

  /** Local Mode (LM Studio): base URL, dummy key, and model ID matching your loaded model */
  localAgent: {
    apiBase: 'http://localhost:1234/v1',
    apiKey: 'lm-studio',
    /** Model ID LM Studio expects (e.g. deepseek-r1-distill-qwen-32b-mlx). Override if you load a different model. */
    modelId: 'deepseek-r1-distill-qwen-32b-mlx',
  },
} as const
