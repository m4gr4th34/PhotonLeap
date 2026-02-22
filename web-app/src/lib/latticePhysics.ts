/**
 * Dual-Purpose Semantic Lattice — physics computations for surfaces.
 * Computes effective_focal_length and critical_angle; generates semantic delta implications.
 */

import type { Surface } from '../types/system'

/** Surface power φ = (n-1)/R. EFL = 1/φ = R/(n-1). For plano (R=0), power is infinite. */
export function computeEffectiveFocalLength(s: Surface): number | null {
  if (s.radius === 0) return null
  const n = s.refractiveIndex ?? 1
  if (Math.abs(n - 1) < 1e-9) return null
  return s.radius / (n - 1)
}

/** TIR critical angle θc = arcsin(n2/n1). For glass→air: arcsin(1/n). Returns degrees. */
export function computeCriticalAngle(s: Surface): number | null {
  const n = s.refractiveIndex ?? 1
  if (n <= 1) return null
  const sinC = 1 / n
  if (sinC > 1) return null
  return (Math.asin(sinC) * 180) / Math.PI
}

/** Enrich surface with computed physics properties. */
export function enrichSurfaceWithPhysics(s: Surface): Surface {
  const efl = computeEffectiveFocalLength(s)
  const ca = computeCriticalAngle(s)
  return {
    ...s,
    effective_focal_length: efl ?? undefined,
    critical_angle: ca ?? undefined,
  }
}

/** Semantic delta emitted when user changes a surface value — includes physical implication. */
export type SemanticDelta = {
  surfaceId: string
  surfaceIndex: number
  semanticName: string
  field: string
  oldValue: unknown
  newValue: unknown
  /** Human-readable physical implication (e.g. 'Increasing thickness by 2mm; likely shifting focus +0.5mm') */
  physicalImplication: string
}

/** Heuristic focus shift for thickness change: Δf ≈ (n-1)/n × Δt for thin lens back-focus. */
function estimateFocusShiftFromThickness(n: number, deltaT: number): number {
  if (n <= 1) return 0
  return ((n - 1) / n) * deltaT
}

/** Heuristic: radius change affects power. Positive R increase → longer EFL. */
function estimateEflChangeFromRadius(oldR: number, newR: number, n: number): number | null {
  if (oldR === 0 || newR === 0 || Math.abs(n - 1) < 1e-9) return null
  const oldEfl = oldR / (n - 1)
  const newEfl = newR / (n - 1)
  return newEfl - oldEfl
}

/** Generate physical implication string for a surface edit. */
export function computeSemanticDeltaImplication(
  surface: Surface,
  field: string,
  oldValue: unknown,
  newValue: unknown,
  surfaceIndex: number
): string {
  const label = surface.semanticName ?? `S${surfaceIndex + 1}`
  const n = surface.refractiveIndex ?? 1

  switch (field) {
    case 'thickness': {
      const oldT = Number(oldValue) || 0
      const newT = Number(newValue) || 0
      const delta = newT - oldT
      if (Math.abs(delta) < 1e-6) return ''
      const dir = delta > 0 ? 'Increasing' : 'Decreasing'
      const shift = estimateFocusShiftFromThickness(n, delta)
      if (surface.type === 'Glass' && Math.abs(shift) > 0.001) {
        const shiftStr = shift >= 0 ? `+${shift.toFixed(2)}` : shift.toFixed(2)
        return `${dir} thickness of ${label} by ${Math.abs(delta).toFixed(2)}mm; likely shifting focus by ${shiftStr}mm`
      }
      return `${dir} thickness of ${label} by ${Math.abs(delta).toFixed(2)}mm`
    }
    case 'radius': {
      const oldR = Number(oldValue) ?? 0
      const newR = Number(newValue) ?? 0
      const delta = newR - oldR
      if (Math.abs(delta) < 1e-6) return ''
      const eflDelta = estimateEflChangeFromRadius(oldR, newR, n)
      if (eflDelta != null && Math.abs(eflDelta) > 0.1) {
        const dir = eflDelta > 0 ? 'longer' : 'shorter'
        return `Changing curvature of ${label}; effective focal length becomes ${dir} by ~${Math.abs(eflDelta).toFixed(1)}mm`
      }
      return `Changing radius of ${label} from ${oldR.toFixed(1)} to ${newR.toFixed(1)}mm`
    }
    case 'refractiveIndex':
    case 'material': {
      const oldN = typeof oldValue === 'number' ? oldValue : 1
      const newN = typeof newValue === 'number' ? newValue : n
      const deltaN = newN - oldN
      if (Math.abs(deltaN) < 1e-4) return ''
      const effect = deltaN > 0 ? 'increases power; shorter focal length' : 'decreases power; longer focal length'
      return `Material change on ${label}: n ${deltaN > 0 ? '+' : ''}${deltaN.toFixed(3)}; ${effect}`
    }
    case 'diameter': {
      const oldD = Number(oldValue) ?? 0
      const newD = Number(newValue) ?? 0
      const delta = newD - oldD
      if (Math.abs(delta) < 1e-6) return ''
      const dir = delta > 0 ? 'Larger' : 'Smaller'
      return `${dir} aperture on ${label} by ${Math.abs(delta).toFixed(1)}mm; affects vignetting and edge rays`
    }
    case 'coating':
      return `Coating change on ${label}; affects reflectivity and power loss`
    default:
      return `Updated ${field} on ${label}`
  }
}
