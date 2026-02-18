import { OpticalViewport } from './OpticalViewport'
import type { SystemState } from '../types/system'
import type { HighlightedMetric } from '../types/ui'

type CanvasProps = {
  systemState: SystemState
  onSystemStateChange: (state: SystemState | ((prev: SystemState) => SystemState)) => void
  selectedSurfaceId: string | null
  onSelectSurface: (id: string | null) => void
  highlightedMetric?: HighlightedMetric
  showPersistentHud?: boolean
}

export function Canvas({
  systemState,
  onSystemStateChange,
  selectedSurfaceId,
  onSelectSurface,
  highlightedMetric = null,
  showPersistentHud = false,
}: CanvasProps) {
  return (
    <div className="h-full min-h-[500px] w-full">
      <OpticalViewport
        className="h-full w-full"
        systemState={systemState}
        onSystemStateChange={onSystemStateChange}
        selectedSurfaceId={selectedSurfaceId}
        onSelectSurface={onSelectSurface}
        highlightedMetric={highlightedMetric}
        showPersistentHud={showPersistentHud}
      />
    </div>
  )
}
