/**
 * ISO 10110 helpers: compile manufacturing data to standard text blocks.
 */

import type { Surface } from '../types/system'

/**
 * Compile LENS-X manufacturing data to ISO 10110 text block.
 * Format: '3/ 2(0.5)' = scratch/dig (tolerance in mm)
 */
export function getISOString(surface: Surface): string {
  const sd = surface.surfaceQuality?.trim() || '3/2'
  const tol = surface.radiusTolerance ?? surface.thicknessTolerance
  if (tol != null && tol > 0) {
    return `${sd}(${tol.toFixed(2)})`
  }
  return sd
}
