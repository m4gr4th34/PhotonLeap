import { useState, useCallback, useEffect } from 'react'
import { NavBar, type NavTab } from './components/NavBar'
import { Canvas } from './components/Canvas'
import { SystemEditor } from './components/SystemEditor'
import { SystemProperties } from './components/SystemProperties'
import {
  DEFAULT_SYSTEM_STATE,
  computePerformance,
  type SystemState,
  type Surface,
} from './types/system'

const STORAGE_KEY = 'last_design'

function normalizeSurface(s: Partial<Surface> & { n?: number }, _i: number): Surface {
  const n = Number(s.refractiveIndex ?? s.n ?? 1) || 1
  return {
    id: crypto.randomUUID(),
    type: s.type === 'Glass' || s.type === 'Air' ? s.type : n > 1.01 ? 'Glass' : 'Air',
    radius: Number(s.radius) || 0,
    thickness: Number(s.thickness) || 10,
    refractiveIndex: n,
    diameter: Number(s.diameter) || 25,
    material: String(s.material ?? 'Air'),
    description: String(s.description ?? ''),
  }
}

function loadLastDesign(): SystemState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data || !Array.isArray(data.surfaces)) return null
    const rawSurfaces = data.surfaces.filter(
      (s: unknown): s is Record<string, unknown> => typeof s === 'object' && s !== null
    )
    const surfaces = rawSurfaces.map((s: Partial<Surface>, i: number) => normalizeSurface(s, i))
    const loaded: SystemState = {
      ...DEFAULT_SYSTEM_STATE,
      surfaces,
      entrancePupilDiameter: Number(data.entrancePupilDiameter) || 10,
      wavelengths: Array.isArray(data.wavelengths) ? data.wavelengths.map(Number) : DEFAULT_SYSTEM_STATE.wavelengths,
      fieldAngles: Array.isArray(data.fieldAngles) ? data.fieldAngles.map(Number) : DEFAULT_SYSTEM_STATE.fieldAngles,
      numRays: Number(data.numRays) || 9,
      hasTraced: false,
      traceResult: null,
      traceError: null,
    }
    return { ...loaded, ...computePerformance(loaded) }
  } catch {
    return null
  }
}

function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('lens')
  const [loadedFileName, setLoadedFileName] = useState<string | null>(null)
  const [selectedSurfaceId, setSelectedSurfaceId] = useState<string | null>(null)
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
