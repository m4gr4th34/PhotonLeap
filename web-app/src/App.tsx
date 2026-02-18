import { useState, useCallback, useEffect } from 'react'
import { NavBar, type NavTab } from './components/NavBar'
import { Canvas } from './components/Canvas'
import { SystemEditor } from './components/SystemEditor'
import { InfoPanel } from './components/InfoPanel'
import { SystemProperties } from './components/SystemProperties'
import {
  DEFAULT_SYSTEM_STATE,
  computePerformance,
  type SystemState,
  type Surface,
} from './types/system'
import { config } from './config'

const STORAGE_KEY = 'last_design'

function normalizeSurface(s: Partial<Surface> & { n?: number }, _i: number): Surface {
  const n = Number(s.refractiveIndex ?? s.n ?? 1) || 1
  const d = config.surfaceDefaults
  return {
    id: (typeof s.id === 'string' && s.id) ? s.id : crypto.randomUUID(),
    type: s.type === 'Glass' || s.type === 'Air' ? s.type : n > 1.01 ? 'Glass' : 'Air',
    radius: Number(s.radius) || 0,
    thickness: Number(s.thickness) || d.thickness,
    refractiveIndex: n,
    diameter: Number(s.diameter) || d.diameter,
    material: String(s.material ?? 'Air'),
    description: String(s.description ?? ''),
  }
}

function loadLastDesign(): SystemState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const optical_stack = JSON.parse(raw)
    if (!optical_stack || !Array.isArray(optical_stack.surfaces)) return null
    const rawSurfaces = optical_stack.surfaces.filter(
      (s: unknown): s is Record<string, unknown> => typeof s === 'object' && s !== null
    )
    const surfaces = rawSurfaces.map((s: Partial<Surface>, i: number) => normalizeSurface(s, i))
    const loaded: SystemState = {
      ...DEFAULT_SYSTEM_STATE,
      surfaces,
      entrancePupilDiameter: Number(optical_stack.entrancePupilDiameter) || config.defaults.entrancePupilDiameter,
      wavelengths: Array.isArray(optical_stack.wavelengths) ? optical_stack.wavelengths.map(Number) : DEFAULT_SYSTEM_STATE.wavelengths,
      fieldAngles: Array.isArray(optical_stack.fieldAngles) ? optical_stack.fieldAngles.map(Number) : DEFAULT_SYSTEM_STATE.fieldAngles,
      numRays: Number(optical_stack.numRays) || 9,
      focusMode: optical_stack.focusMode === 'Balanced' ? 'Balanced' : 'On-Axis',
      hasTraced: false,
      traceResult: null,
      traceError: null,
    }
    return { ...loaded, ...computePerformance(loaded) }
  } catch {
    return null
  }
}

import type { HighlightedMetric } from './types/ui'

function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('lens')
  const [loadedFileName, setLoadedFileName] = useState<string | null>(null)
  const [selectedSurfaceId, setSelectedSurfaceId] = useState<string | null>(null)
  const [highlightedMetric, setHighlightedMetric] = useState<HighlightedMetric>(null)
  const [systemState, setSystemState] = useState<SystemState>(() => {
    const loaded = loadLastDesign()
    return loaded ?? { ...DEFAULT_SYSTEM_STATE, ...computePerformance(DEFAULT_SYSTEM_STATE) }
  })

  useEffect(() => {
    const toSave = {
      surfaces: systemState.surfaces,
      entrancePupilDiameter: systemState.entrancePupilDiameter,
      wavelengths: systemState.wavelengths,
      fieldAngles: systemState.fieldAngles,
      numRays: systemState.numRays,
      focusMode: systemState.focusMode ?? 'On-Axis',
      totalLength: systemState.totalLength,
      fNumber: systemState.fNumber,
      rmsSpotRadius: systemState.rmsSpotRadius,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
  }, [systemState])

  const onSystemStateChange = useCallback(
    (update: SystemState | ((prev: SystemState) => SystemState)) => {
      setSystemState((prev) => {
        const next =
          typeof update === 'function' ? update(prev) : { ...prev, ...update }
        const perf = computePerformance(next)
        return { ...next, ...perf }
      })
    },
    []
  )

  return (
    <div className="min-h-screen bg-midnight flex flex-col">
      <NavBar activeTab={activeTab} onTabChange={setActiveTab} loadedFileName={loadedFileName} />
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-auto p-4">
          {activeTab === 'lens' && (
            <Canvas
              systemState={systemState}
              onSystemStateChange={onSystemStateChange}
              selectedSurfaceId={selectedSurfaceId}
              onSelectSurface={setSelectedSurfaceId}
              highlightedMetric={null}
            />
          )}
          {activeTab === 'system' && (
            <SystemEditor
              systemState={systemState}
              onSystemStateChange={onSystemStateChange}
              onLoadComplete={setLoadedFileName}
              selectedSurfaceId={selectedSurfaceId}
              onSelectSurface={setSelectedSurfaceId}
            />
          )}
          {activeTab === 'info' && (
            <div className="flex flex-1 min-h-0 gap-4">
              <div className="w-96 shrink-0 overflow-y-auto">
                <InfoPanel
                  highlightedMetric={highlightedMetric}
                  onHighlightMetric={setHighlightedMetric}
                />
              </div>
              <div className="flex-1 min-w-0 min-h-[400px]">
                <Canvas
                  systemState={systemState}
                  onSystemStateChange={onSystemStateChange}
                  selectedSurfaceId={selectedSurfaceId}
                  onSelectSurface={setSelectedSurfaceId}
                  highlightedMetric={highlightedMetric}
                  showPersistentHud
                />
              </div>
            </div>
          )}
          {activeTab === 'properties' && (
            <div className="h-full flex items-center justify-center text-slate-400">
              Properties view — use the right sidebar
            </div>
          )}
          {activeTab === 'export' && (
            <div className="h-full flex items-center justify-center text-slate-400">
              Export view — coming soon
            </div>
          )}
        </main>
        <aside className="w-80 shrink-0 overflow-auto">
          <SystemProperties
            systemState={systemState}
            onSystemStateChange={onSystemStateChange}
            selectedSurfaceId={selectedSurfaceId}
            onSelectSurface={setSelectedSurfaceId}
          />
        </aside>
      </div>
    </div>
  )
}

export default App
