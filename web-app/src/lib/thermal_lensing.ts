/**
 * Thermal lensing calculation for high-power CW lasers.
 * Uses thermo-optic effect (dn/dT) — absorbed power creates radial temperature
 * gradient → refractive index gradient → effective focal length change.
 */

import type { SystemState } from '../types/system'

/** Thermo-optic coefficient dn/dT (1/°C) — typical for N-BK7 and similar glasses */
const DN_DT = 2.8e-6
/** Thermal conductivity κ (W/(m·K)) — N-BK7 */
const KAPPA = 1.05

export type ThermalLensingResult = {
  /** Cold (design) EFL in mm */
  eflCold: number
  /** Thermal lens focal length in mm (positive = focusing) */
  fThermal: number
  /** Effective EFL under heating in mm */
  eflEffective: number
  /** Δf = eflEffective - eflCold (mm) */
  deltaEfl: number
  /** Absorbed power in first glass element (W) */
  pAbsorbed: number
  /** Whether thermal effects are significant */
  hasSignificantHeating: boolean
}

/**
 * Compute thermal lensing for the first glass element.
 * Formula: f_thermal = π * κ * w² / (P_abs * dn/dT)
 * P_abs = P * (1 - exp(-α*L)) with α in 1/cm, L in cm.
 */
export function computeThermalLensing(
  state: SystemState,
  eflColdMm: number
): ThermalLensingResult {
  const laserPowerW = state.laserPowerW ?? 0
  const epd = state.entrancePupilDiameter ?? 10

  const firstGlass = state.surfaces.find((s) => s.type === 'Glass')
  if (!firstGlass || laserPowerW <= 0) {
    return {
      eflCold: eflColdMm,
      fThermal: Infinity,
      eflEffective: eflColdMm,
      deltaEfl: 0,
      pAbsorbed: 0,
      hasSignificantHeating: false,
    }
  }

  const alpha = firstGlass.absorptionCoefficient ?? 0
  const thicknessMm = firstGlass.thickness ?? 0
  const thicknessCm = thicknessMm / 10

  const pAbsorbed = alpha > 0 && thicknessCm > 0
    ? laserPowerW * (1 - Math.exp(-alpha * thicknessCm))
    : 0

  if (pAbsorbed <= 0) {
    return {
      eflCold: eflColdMm,
      fThermal: Infinity,
      eflEffective: eflColdMm,
      deltaEfl: 0,
      pAbsorbed: 0,
      hasSignificantHeating: false,
    }
  }

  const wM = (epd / 2) / 1000
  const wSq = wM * wM
  const fThermalM = (Math.PI * KAPPA * wSq) / (pAbsorbed * DN_DT)
  const fThermalMm = fThermalM * 1000

  const eflColdM = eflColdMm / 1000
  const invCold = 1 / eflColdM
  const invThermal = 1 / fThermalM
  const invEff = invCold + invThermal
  const eflEffectiveM = 1 / invEff
  const eflEffective = eflEffectiveM * 1000
  const deltaEfl = eflEffective - eflColdMm

  return {
    eflCold: eflColdMm,
    fThermal: fThermalMm,
    eflEffective,
    deltaEfl,
    pAbsorbed,
    hasSignificantHeating: true,
  }
}
