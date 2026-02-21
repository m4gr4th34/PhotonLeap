/**
 * Physics constants — single source of truth for agents and kernels.
 * Prevents hallucinated values across trace.py, OpticalViewport, and AI agents.
 * Composer-ready: all physics constants live here.
 */

/** Speed of light in vacuum (m/s) — SI definition */
export const SPEED_OF_LIGHT_M_S = 299_792_458

/** Planck constant (J⋅s) — for quantum/wavefront kernels */
export const PLANCK_J_S = 6.626_070_15e-34

/** Boltzmann constant (J/K) — for thermal lensing */
export const BOLTZMANN_J_K = 1.380_649e-23

/** Vacuum permittivity ε₀ (F/m) */
export const VACUUM_PERMITTIVITY = 8.854_187_8128e-12

/** Vacuum permeability μ₀ (H/m) */
export const VACUUM_PERMEABILITY = 1.256_637_062_12e-6

/** Wavelength-to-frequency: f = c/λ. λ in nm → f in Hz */
export function wavelengthNmToFrequencyHz(lambdaNm: number): number {
  return (SPEED_OF_LIGHT_M_S * 1e9) / lambdaNm
}

/** Default design wavelength (nm) — d-line */
export const DEFAULT_WAVELENGTH_NM = 587.6
