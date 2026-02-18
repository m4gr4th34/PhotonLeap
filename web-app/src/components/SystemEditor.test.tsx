import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SystemEditor } from './SystemEditor'
import { DEFAULT_SYSTEM_STATE, computePerformance } from '../types/system'

describe('SystemEditor', () => {
  it('clicking the insert surface row increases the number of rows in the table', () => {
    const initialSurfaces = [...DEFAULT_SYSTEM_STATE.surfaces]
    const initialCount = initialSurfaces.length

    const systemState = {
      ...DEFAULT_SYSTEM_STATE,
      ...computePerformance(DEFAULT_SYSTEM_STATE),
      surfaces: initialSurfaces,
    }

    const onSystemStateChange = vi.fn()

    render(
      <SystemEditor
        systemState={systemState}
        onSystemStateChange={onSystemStateChange}
        selectedSurfaceId={null}
        onSelectSurface={() => {}}
      />
    )

    // Each surface row has a radius input; count them
    const radiusInputs = screen.getAllByDisplayValue(String(initialSurfaces[0].radius))
    expect(radiusInputs.length).toBeGreaterThanOrEqual(1)

    // Click the insert row to add a surface
    const insertRow = screen.getByTestId('insert-surface-at-start')
    fireEvent.click(insertRow)

    expect(onSystemStateChange).toHaveBeenCalled()
    const updateFn = onSystemStateChange.mock.calls[0][0]
    expect(typeof updateFn).toBe('function')

    const prevState = systemState
    const nextState = updateFn(prevState)
    expect(nextState.surfaces.length).toBe(initialCount + 1)
  })
})
