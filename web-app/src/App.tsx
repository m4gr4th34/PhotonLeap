/** MacOptics v2.0 — GitHub Pages deploy */
import { useState, useCallback, useEffect, useRef } from 'react'
import { NavBar, type NavTab } from './components/NavBar'
import { isPyodideEnabled, waitForPyodideReady } from './lib/pythonBridge'
import { Canvas } from './components/Canvas'
import { SystemEditor } from './components/SystemEditor'
import { InfoPanel } from './components/InfoPanel'
import { ExportDrawing } from './components/ExportDrawing'
import { CoatingLab } from './components/CoatingLab'
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
    radiusTolerance: s.radiusTolerance != null ? Number(s.radiusTolerance) : undefined,
    thicknessTolerance: s.thicknessTolerance != null ? Number(s.thicknessTolerance) : undefined,
    tiltTolerance: s.tiltTolerance != null ? Number(s.tiltTolerance) : undefined,
    absorptionCoefficient: s.absorptionCoefficient != null ? Number(s.absorptionCoefficient) : undefined,
    surfaceQuality: s.surfaceQuality != null ? String(s.surfaceQuality) : undefined,
    coating: s.coating != null ? String(s.coating) : undefined,
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
      fieldAngles: Array.isArray(optical_stack.fieldAngles)
        ? optical_stack.fieldAngles.map(Number).slice(0, config.maxFieldAngles)
        : DEFAULT_SYSTEM_STATE.fieldAngles,
      numRays: Number(optical_stack.numRays) || 9,
      focusMode: optical_stack.focusMode === 'Balanced' ? 'Balanced' : 'On-Axis',
      m2Factor: Math.max(0.1, Math.min(10, Number(optical_stack.m2Factor) || 1)),
      pulseWidthFs: Math.max(5, Math.min(10000, Number(optical_stack.pulseWidthFs) || 100)),
      laserPowerW: optical_stack.laserPowerW != null ? Number(optical_stack.laserPowerW) : undefined,
      projectName: typeof optical_stack.projectName === 'string' ? optical_stack.projectName : undefined,
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

const BOOT_MESSAGES = [
  '[ SYSTEM ] Initializing WebAssembly Runtime...',
  '[ CORE ] Downloading Optical Physics Libraries (NumPy)...',
  '[ NEURAL ] Establishing Local Memory Bridge...',
  '[ READY ] Photon Leap V2.0 Active.',
] as const

function NeuralLinkBootSequence({ onReady }: { onReady: () => void }) {
  const [messageIndex, setMessageIndex] = useState(0)
  const [progress, setProgress] = useState(0)
  const [isComplete, setIsComplete] = useState(false)
  const rafRef = useRef<number>()

  useEffect(() => {
    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout>
    waitForPyodideReady().then(() => {
      if (cancelled) return
      setMessageIndex(BOOT_MESSAGES.length - 1)
      setProgress(100)
      setIsComplete(true)
      timeoutId = setTimeout(onReady, 800)
    })
    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [onReady])

  useEffect(() => {
    if (isComplete) return
    const interval = setInterval(() => {
      setMessageIndex((i) => Math.min(i + 1, BOOT_MESSAGES.length - 2))
    }, 2200)
    return () => clearInterval(interval)
  }, [isComplete])

  useEffect(() => {
    if (isComplete) return
    const start = performance.now()
    const animate = () => {
      const elapsed = performance.now() - start
      const target = Math.min(92, (elapsed / 12000) * 92)
      setProgress(target)
      if (target < 92) rafRef.current = requestAnimationFrame(animate)
    }
    rafRef.current = requestAnimationFrame(animate)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [isComplete])

  return (
    <div className="fixed inset-0 z-[9999] bg-black flex flex-col items-center justify-center">
      <div className="w-full max-w-md px-8">
        <p
          className="font-mono text-sm text-cyan-400 mb-6 tracking-widest min-h-[2.5rem]"
          style={{ textShadow: '0 0 12px rgba(34, 211, 238, 0.6)' }}
        >
          {BOOT_MESSAGES[messageIndex]}
        </p>
        <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300 ease-out"
            style={{
              width: `${progress}%`,
              background: 'linear-gradient(90deg, #0891b2 0%, #22d3ee 50%, #67e8f9 100%)',
              boxShadow: '0 0 20px rgba(34, 211, 238, 0.8), 0 0 40px rgba(34, 211, 238, 0.4)',
            }}
          />
        </div>
      </div>
    </div>
  )
}

function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('lens')
  const [loadedFileName, setLoadedFileName] = useState<string | null>(null)
  const [selectedSurfaceId, setSelectedSurfaceId] = useState<string | null>(null)
  const [highlightedMetric, setHighlightedMetric] = useState<HighlightedMetric>(null)
  const [showBestFocus, setShowBestFocus] = useState(true)
  const [snapToFocus, setSnapToFocus] = useState(true)
  const [snapToSurface, setSnapToSurface] = useState(true)
  const runSampleAnalysisRef = useRef<(() => void) | null>(null)
  const pulseOptimizeRef = useRef<(() => void) | null>(null)
  const [sensitivityBySurface, setSensitivityBySurface] = useState<number[] | null>(null)
  const [systemState, setSystemState] = useState<SystemState>(() => {
    const loaded = loadLastDesign()
    return loaded ?? { ...DEFAULT_SYSTEM_STATE, ...computePerformance(DEFAULT_SYSTEM_STATE) }
  })
  const [showBootOverlay, setShowBootOverlay] = useState(() => isPyodideEnabled())

  useEffect(() => {
    setSensitivityBySurface(null)
  }, [systemState.surfaces])

  useEffect(() => {
    const toSave = {
      surfaces: systemState.surfaces,
      entrancePupilDiameter: systemState.entrancePupilDiameter,
      wavelengths: systemState.wavelengths,
      fieldAngles: systemState.fieldAngles,
      numRays: systemState.numRays,
      focusMode: systemState.focusMode ?? 'On-Axis',
      m2Factor: systemState.m2Factor ?? 1.0,
      pulseWidthFs: systemState.pulseWidthFs ?? 100,
      laserPowerW: systemState.laserPowerW,
      projectName: systemState.projectName,
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
        const truncated = {
          ...next,
          fieldAngles: (next.fieldAngles ?? [0]).slice(0, config.maxFieldAngles),
        }
        const perf = computePerformance(truncated)
        return { ...truncated, ...perf }
      })
    },
    []
  )

  return (
    <div className="min-h-screen bg-midnight flex flex-col">
      {showBootOverlay && (
        <NeuralLinkBootSequence onReady={() => setShowBootOverlay(false)} />
      )}
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
              showBestFocus={showBestFocus}
              snapToFocus={snapToFocus}
              snapToSurface={snapToSurface}
              onMonteCarloSensitivity={setSensitivityBySurface}
            />
          )}
          {activeTab === 'coating' && <CoatingLab />}
          {activeTab === 'system' && (
            <SystemEditor
              systemState={systemState}
              onSystemStateChange={onSystemStateChange}
              onLoadComplete={setLoadedFileName}
              selectedSurfaceId={selectedSurfaceId}
              onSelectSurface={setSelectedSurfaceId}
              sensitivityBySurface={sensitivityBySurface}
            />
          )}
          {activeTab === 'info' && (
            <div className="flex flex-1 min-h-0 gap-4">
              <div className="w-96 shrink-0 overflow-y-auto">
                <InfoPanel
                  highlightedMetric={highlightedMetric}
                  onHighlightMetric={setHighlightedMetric}
                  onSystemStateChange={onSystemStateChange}
                  onRunSampleAnalysis={() => runSampleAnalysisRef.current?.()}
                  onOpenOptimizer={() => pulseOptimizeRef.current?.()}
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
                  showBestFocus={showBestFocus}
                  snapToFocus={snapToFocus}
                  snapToSurface={snapToSurface}
                  runSampleAnalysisRef={runSampleAnalysisRef}
                  pulseOptimizeRef={pulseOptimizeRef}
                  onMonteCarloSensitivity={setSensitivityBySurface}
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
            <ExportDrawing
              systemState={systemState}
              onSystemStateChange={onSystemStateChange}
            />
          )}
        </main>
        <aside className="w-80 shrink-0 overflow-auto">
          <SystemProperties
            systemState={systemState}
            onSystemStateChange={onSystemStateChange}
            selectedSurfaceId={selectedSurfaceId}
            onSelectSurface={setSelectedSurfaceId}
            showBestFocus={showBestFocus}
            onShowBestFocusChange={setShowBestFocus}
            snapToFocus={snapToFocus}
            onSnapToFocusChange={setSnapToFocus}
            snapToSurface={snapToSurface}
            onSnapToSurfaceChange={setSnapToSurface}
          />
        </aside>
      </div>
    </div>
  )
}

export default App
