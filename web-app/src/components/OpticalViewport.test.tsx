import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OpticalViewport } from './OpticalViewport'
import {
  DEFAULT_SYSTEM_STATE,
  computePerformance,
  type SystemState,
  type Surface,
} from '../types/system'

function makeSystemState(surfaces: Surface[]): SystemState {
  const state: SystemState = {
    ...DEFAULT_SYSTEM_STATE,
    surfaces,
    hasTraced: false,
    traceResult: null,
    traceError: null,
  }
  return { ...state, ...computePerformance(state) }
}

describe('OpticalViewport', () => {
  it('changing a surface radius in the state updates the SVG path data for that lens', () => {
    const surface1: Surface = {
      id: 's1',
      type: 'Glass',
      radius: 100,
      thickness: 5,
      refractiveIndex: 1.5168,
      diameter: 25,
      material: 'N-BK7',
      description: 'Front',
    }
    const surface2: Surface = {
      id: 's2',
      type: 'Air',
      radius: -100,
      thickness: 95,
      refractiveIndex: 1,
      diameter: 25,
      material: 'Air',
      description: 'Back',
    }

    const onSystemStateChange = vi.fn()
    const systemState = makeSystemState([surface1, surface2])

    const { rerender } = render(
      <OpticalViewport
        systemState={systemState}
        onSystemStateChange={onSystemStateChange}
      />
    )

    // Get SVG paths - lens elements use path elements with d attribute
    const paths = document.querySelectorAll('svg path')
    expect(paths.length).toBeGreaterThan(0)

    // Capture initial path data for the first curved surface (radius 100 produces arc)
    const initialPaths = Array.from(paths).map((p) => p.getAttribute('d')).filter(Boolean)
    expect(initialPaths.length).toBeGreaterThan(0)

    // Update state with different radius for first surface
    const updatedSurface1: Surface = { ...surface1, radius: 50 }
    const updatedState = makeSystemState([updatedSurface1, surface2])

    rerender(
      <OpticalViewport
        systemState={updatedState}
        onSystemStateChange={onSystemStateChange}
      />
    )

    // Path data should have changed (radius affects the arc curvature)
    const updatedPaths = Array.from(document.querySelectorAll('svg path')).map((p) =>
      p.getAttribute('d')
    ).filter(Boolean)

    expect(updatedPaths.length).toBeGreaterThan(0)
    // At least one path should differ from initial (radius change affects surface profile)
    const hasChanged = initialPaths.some(
      (initial, i) => initial !== updatedPaths[i]
    )
    expect(hasChanged).toBe(true)
  })
})
