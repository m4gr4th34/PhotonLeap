import { useMemo, useState, useCallback, useEffect, useRef } from 'react'

/** Debug: log HUD z (optical mm) and RMS. Set true to diagnose HUD/line disconnect. */
const DEBUG_HUD_COORDS = import.meta.env.DEV
/** Debug: log HUD vs Diamond RMS to diagnose math vs rendering bug. */
const DEBUG_FOCUS_ALIGNMENT = import.meta.env.DEV
import { motion, AnimatePresence } from 'framer-motion'
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'
import { Play, Loader2, ZoomIn, ZoomOut, Maximize2, Dices, LineChart } from 'lucide-react'
import type { SystemState, TraceResult, MetricsAtZ } from '../types/system'
import type { HighlightedMetric } from '../types/ui'
import { traceOpticalStack, runMonteCarlo, type MonteCarloResponse } from '../api/trace'
import { isPyodideEnabled } from '../lib/pythonBridge'
import { ChromaticAberrationOverlay } from './ChromaticAberrationOverlay'
import { config } from '../config'
import { computeDispersion } from '../lib/dispersion'

/** Render Monte Carlo point cloud with color-coded ghost points.
 * Cyan = within 1σ (in spec), Red = outliers (would fail performance test). */
function renderMonteCarloCloud(
  spots: [number, number][],
  opts: {
    centerX: number
    centerY: number
    scale: number
    dotRadius?: number
    inSpecOpacity?: number
    outlierOpacity?: number
  }
): { dots: React.ReactNode; inSpecCount: number; outlierCount: number } {
  const { centerX, centerY, scale, dotRadius = 1.2, inSpecOpacity = 0.5, outlierOpacity = 0.6 } = opts
  if (!spots.length) return { dots: null, inSpecCount: 0, outlierCount: 0 }

  const cx = spots.reduce((s, [x]) => s + x, 0) / spots.length
  const cy = spots.reduce((s, [, y]) => s + y, 0) / spots.length
  const distances = spots.map(([x, y]) => Math.sqrt((x - cx) ** 2 + (y - cy) ** 2))
  const meanD = distances.reduce((a, b) => a + b, 0) / distances.length
  const variance = distances.reduce((s, d) => s + (d - meanD) ** 2, 0) / distances.length
  const sigma = Math.sqrt(variance) || 0.001

  let inSpecCount = 0
  let outlierCount = 0
  const dots = spots.map(([sx, sy], i) => {
    const d = distances[i]
    const isOutlier = d > sigma
    if (isOutlier) outlierCount++
    else inSpecCount++
    const px = centerX + sx * scale
    const py = centerY - sy * scale
    return (
      <circle
        key={i}
        cx={px}
        cy={py}
        r={dotRadius}
        fill={isOutlier ? 'rgba(239, 68, 68, 0.85)' : 'rgba(34, 211, 238, 0.85)'}
        opacity={isOutlier ? outlierOpacity : inSpecOpacity}
      />
    )
  })

  return { dots, inSpecCount, outlierCount }
}

/** Through-Focus diagnostic: 10mm sparkline around cursor with Gold Diamond minimum line.
 * If the dip doesn't align with the dotted line → search algorithm failure. */
function ThroughFocusSparkline({
  sweep,
  cursorZ,
  diamondZ,
  width = 140,
  height = 44,
}: {
  sweep: MetricsAtZ[]
  cursorZ: number
  diamondZ: number | null
  width?: number
  height?: number
}) {
  if (!sweep.length) return null
  const halfWindow = 5
  const zLo = cursorZ - halfWindow
  const zHi = cursorZ + halfWindow
  const zRange = zHi - zLo || 1
  const windowSweep = sweep.filter((p) => p.z >= zLo - 0.01 && p.z <= zHi + 0.01)
  if (windowSweep.length < 2) return null

  const pts = windowSweep
    .map((p) => {
      const rms = p.rmsPerField?.length
        ? (() => {
            const valid = p.rmsPerField!.filter((r): r is number => r != null)
            return valid.length > 0 ? Math.sqrt(valid.reduce((s, r) => s + r * r, 0) / valid.length) : null
          })()
        : p.rmsRadius
      return { z: p.z, rms }
    })
    .filter(({ rms }) => rms != null) as { z: number; rms: number }[]
  if (pts.length < 2) return null

  const rmsMax = Math.max(...pts.map((p) => p.rms), 1e-6)
  const pad = 4
  const w = width - 2 * pad
  const h = height - 2 * pad

  const pathPts = pts.map(({ z, rms }) => {
    const x = pad + (w * (z - zLo)) / zRange
    const y = pad + h - (h * (rms / rmsMax))
    return `${x},${y}`
  })
  const pathD = `M ${pathPts.join(' L ')}`

  const cursorX = pad + (w * Math.max(0, Math.min(1, (cursorZ - zLo) / zRange)))
  const diamondX =
    diamondZ != null && diamondZ >= zLo && diamondZ <= zHi
      ? pad + (w * (diamondZ - zLo)) / zRange
      : null

  return (
    <svg width={width} height={height} className="block">
      <path
        d={pathD}
        fill="none"
        stroke="rgba(34, 211, 238, 0.9)"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={cursorX}
        y1={pad}
        x2={cursorX}
        y2={height - pad}
        stroke="#f97316"
        strokeWidth="1"
        strokeDasharray="2 2"
      />
      {diamondX != null && (
        <line
          x1={diamondX}
          y1={pad}
          x2={diamondX}
          y2={height - pad}
          stroke="#F59E0B"
          strokeWidth="1.5"
          strokeDasharray="3 2"
          opacity={0.95}
        />
      )}
    </svg>
  )
}

/** Mini RMS vs Z graph for HUD — shows curve and current cursor Z.
 * When rmsPerField exists, plots System Average RMS (same metric Best Composite minimizes). */
function RmsVsZGraph({
  sweep,
  currentZ,
  width = 100,
  height = 36,
}: {
  sweep: MetricsAtZ[]
  currentZ: number
  width?: number
  height?: number
}) {
  if (!sweep.length) return null
  const zMin = sweep[0].z
  const zMax = sweep[sweep.length - 1].z
  const zRange = zMax - zMin || 1
  const rmsVals = sweep.map((p) => {
    if (p.rmsPerField?.length) {
      const valid = p.rmsPerField.filter((r): r is number => r != null)
      return valid.length > 0 ? Math.sqrt(valid.reduce((s, r) => s + r * r, 0) / valid.length) : null
    }
    return p.rmsRadius
  }).filter((r): r is number => r != null)
  const rmsMax = Math.max(...rmsVals, 1e-6)
  const pad = 2
  const w = width - 2 * pad
  const h = height - 2 * pad
  const pts = sweep
    .map((p) => {
      const rms = p.rmsPerField?.length
        ? (() => {
            const valid = p.rmsPerField!.filter((r): r is number => r != null)
            return valid.length > 0 ? Math.sqrt(valid.reduce((s, r) => s + r * r, 0) / valid.length) : null
          })()
        : p.rmsRadius
      return { z: p.z, rms }
    })
    .filter(({ rms }) => rms != null)
    .map(({ z, rms }) => {
      const x = pad + (w * (z - zMin)) / zRange
      const y = pad + h - (h * (rms! / rmsMax))
      return `${x},${y}`
    })
  const pathD = pts.length >= 2 ? `M ${pts.join(' L ')}` : ''
  const cursorX = pad + (w * Math.max(0, Math.min(1, (currentZ - zMin) / zRange)))
  return (
    <svg width={width} height={height} className="block">
      {pathD && (
        <path
          d={pathD}
          fill="none"
          stroke="rgba(34, 211, 238, 0.8)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <line
        x1={cursorX}
        y1={pad}
        x2={cursorX}
        y2={height - pad}
        stroke="#f97316"
        strokeWidth="1"
        strokeDasharray="2 2"
      />
    </svg>
  )
}

function HudRow({
  label,
  value,
  metricId,
  highlightedMetric,
  labelColor,
}: {
  label: string
  value: string
  metricId: Exclude<HighlightedMetric, null>
  highlightedMetric: HighlightedMetric
  labelColor?: string
}) {
  const isHighlighted = highlightedMetric === metricId
  return (
    <>
      <span
        className={isHighlighted ? 'text-cyan-electric' : 'text-slate-400'}
        style={labelColor && !isHighlighted ? { color: labelColor } : undefined}
      >
        {label}
      </span>
      <span
        className="tabular-nums"
        style={{
          color: labelColor ?? 'var(--electric-cyan, #22D3EE)',
          ...(isHighlighted
            ? { boxShadow: '0 0 12px rgba(34, 211, 238, 0.6)', borderRadius: 4, padding: '0 4px' }
            : {}),
        }}
      >
        {value}
      </span>
    </>
  )
}

const GRID_SIZE = 64
const GRID_EXTENT = 10000
const SCAN_SNAP_PX = 10

type RayPoint = { x: number; y: number }
type Ray = { points: RayPoint[]; color: string }

// Paraxial fallback rays when backend unavailable
function generateRays(
  numRays: number,
  lensX1: number,
  lensX2: number,
  focusX: number,
  semiHeight: number
): Ray[] {
  const rays: Ray[] = []
  for (let i = 0; i < numRays; i++) {
    const t = numRays === 1 ? 0.5 : i / (numRays - 1)
    const y = (t - 0.5) * 2 * semiHeight * 0.9
    const distFromCenter = Math.abs(t - 0.5)
    const colors = config.rayColors
    const color =
      distFromCenter < 0.15 ? colors[0] : distFromCenter < 0.4 ? colors[1] : colors[2]
    const focusY = y * config.paraxial.focusYFactor
    const points: RayPoint[] = [
      { x: 0, y },
      { x: lensX1, y },
      { x: lensX2, y: y + (focusY - y) * config.paraxial.lensToFocusFactor },
      { x: focusX, y: focusY },
    ]
    rays.push({ points, color })
  }
  return rays
}

/** Compute cumulative Z positions for surfaces (mm) */
function computeCumulativeZ(surfaces: { thickness: number }[]): number[] {
  const z: number[] = []
  let cum = 0
  for (let i = 0; i < surfaces.length; i++) {
    z.push(cum)
    cum += surfaces[i].thickness ?? 0
  }
  return z
}

/**
 * Auto-Zoom: compute scale and offset so the entire optical system is centered and visible.
 * Uses Z_total (total length) and D_max (max diameter) from surfaces.
 * Recomputes whenever surfaces or thicknesses change.
 */
function computeViewTransform(
  traceResult: TraceResult | null,
  surfaces: { thickness: number; diameter?: number }[],
  epd: number,
  viewWidth: number,
  viewHeight: number
): { scale: number; xOffset: number; cy: number } {
  const { padding, scaleFactor, minZExtent, extendZFactor, extendZMin } = config.view
  const cy = viewHeight / 2

  // Z_total = total length of system (sum of all thicknesses)
  const zTotal = surfaces.reduce((sum, s) => sum + (s.thickness ?? 0), 0)
  // D_max = maximum diameter across all surfaces and entrance pupil
  const dMax = surfaces.length
    ? Math.max(epd, ...surfaces.map((s) => s.diameter ?? epd))
    : epd
  const yExtent = Math.max(dMax / 2, 5)

  let zMin = 0
  let zMax = Math.max(zTotal, extendZMin)

  if (surfaces.length) {
    zMin = -Math.max(minZExtent, zTotal * extendZFactor)
    zMax = zTotal + Math.max(extendZMin, zTotal * extendZFactor)
  }

  let effectiveYExtent = yExtent
  if (traceResult?.rays?.length || traceResult?.surfaces?.length) {
    const scan = (z: number, y: number) => {
      zMin = Math.min(zMin, z)
      zMax = Math.max(zMax, z)
      effectiveYExtent = Math.max(effectiveYExtent, Math.abs(y))
    }
    for (const ray of traceResult.rays ?? []) {
      for (const [z, y] of ray) scan(z, y)
    }
    for (const surf of traceResult.surfaces ?? []) {
      for (const [z, y] of surf) scan(z, y)
    }
    if (traceResult.focusZ != null) scan(traceResult.focusZ, 0)
  }

  const zRange = zMax - zMin
  const yRange = 2 * effectiveYExtent + 10
  const scale = Math.min(
    (viewWidth - 2 * padding) / zRange,
    (viewHeight - 2 * padding) / yRange
  ) * scaleFactor
  const zCenter = (zMin + zMax) / 2
  const xOffset = viewWidth / 2 - zCenter * scale

  return { scale, xOffset, cy }
}

/** Compute optical content bounds (Z range, Y extent) for fit-to-view. */
function computeOpticalBounds(
  traceResult: TraceResult | null,
  surfaces: { thickness: number; diameter?: number }[],
  epd: number
): { zRange: number; yExtent: number } {
  const { minZExtent, extendZFactor, extendZMin } = config.view
  const zTotal = surfaces.reduce((sum, s) => sum + (s.thickness ?? 0), 0)
  const dMax = surfaces.length
    ? Math.max(epd, ...surfaces.map((s) => s.diameter ?? epd))
    : epd
  let yExtent = Math.max(dMax / 2, 5)
  let zMin = 0
  let zMax = Math.max(zTotal, extendZMin)
  if (surfaces.length) {
    zMin = -Math.max(minZExtent, zTotal * extendZFactor)
    zMax = zTotal + Math.max(extendZMin, zTotal * extendZFactor)
  }
  if (traceResult?.rays?.length || traceResult?.surfaces?.length) {
    const scan = (z: number, y: number) => {
      zMin = Math.min(zMin, z)
      zMax = Math.max(zMax, z)
      yExtent = Math.max(yExtent, Math.abs(y))
    }
    for (const ray of traceResult.rays ?? []) {
      for (const [z, y] of ray) scan(z, y)
    }
    for (const surf of traceResult.surfaces ?? []) {
      for (const [z, y] of surf) scan(z, y)
    }
    if (traceResult.focusZ != null) scan(traceResult.focusZ, 0)
  }
  return { zRange: zMax - zMin, yExtent }
}

/**
 * Interpolate ray Y at Z — matches backend _interpolate_ray_at_z logic exactly.
 * Ray format: [[z,y], [z,y], ...]. Returns y or null.
 */
function interpolateRayAtZ(ray: number[][], zPos: number): number | null {
  if (!ray?.length || ray.length < 2) return null
  const zVals = ray.map((p) => p[0])
  const yVals = ray.map((p) => p[1])
  const zMin = Math.min(...zVals)
  const zMax = Math.max(...zVals)
  if (zPos <= zMin) {
    const dz = zVals[1] - zVals[0]
    const dy = yVals[1] - yVals[0]
    const slope = Math.abs(dz) > 1e-12 ? dy / dz : 0
    return yVals[0] + slope * (zPos - zVals[0])
  }
  if (zPos >= zMax) {
    const dz = zVals[zVals.length - 1] - zVals[zVals.length - 2]
    const dy = yVals[yVals.length - 1] - yVals[yVals.length - 2]
    const slope = Math.abs(dz) > 1e-12 ? dy / dz : 0
    return yVals[yVals.length - 1] + slope * (zPos - zVals[zVals.length - 1])
  }
  for (let i = 0; i < ray.length - 1; i++) {
    const z0 = zVals[i]
    const z1 = zVals[i + 1]
    if (z0 <= zPos && zPos <= z1) {
      const dz = z1 - z0
      const t = Math.abs(dz) > 1e-12 ? (zPos - z0) / dz : 0
      return yVals[i] + t * (yVals[i + 1] - yVals[i])
    }
  }
  return null
}

/**
 * Compute caustic envelope path (upper + lower boundary of ray bundle).
 * Uses interpolateRayAtZ — same logic as backend get_metrics_at_z.
 */
function computeCausticEnvelope(
  rays: number[][][] | undefined,
  toSvg: (z: number, y: number) => string,
  numSamples = 80
): string | null {
  if (!rays?.length) return null
  const allZ: number[] = []
  for (const ray of rays) {
    for (const pt of ray) allZ.push(pt[0])
  }
  const zMin = Math.min(...allZ)
  const zMax = Math.max(...allZ)
  if (zMax <= zMin) return null
  const zSamples: number[] = []
  for (let i = 0; i <= numSamples; i++) {
    zSamples.push(zMin + (i / numSamples) * (zMax - zMin))
  }
  const upper: string[] = []
  const lower: string[] = []
  for (const z of zSamples) {
    const ys: number[] = []
    for (const ray of rays) {
      const y = interpolateRayAtZ(ray, z)
      if (y != null) ys.push(y)
    }
    if (ys.length > 0) {
      const maxY = Math.max(...ys)
      const minY = Math.min(...ys)
      upper.push(toSvg(z, maxY))
      lower.push(toSvg(z, minY))
    }
  }
  if (upper.length < 2) return null
  const upperPath = `M ${upper.join(' L ')}`
  const lowerPath = `L ${[...lower].reverse().join(' L ')} Z`
  return `${upperPath} ${lowerPath}`
}

/**
 * Interpolate metrics at arbitrary Z from precomputed sweep.
 * Uses optical Z (mm) — NOT screen pixels or array indices.
 * Sweep is from backend: [{z, rmsRadius, ...}, ...] with z in mm.
 */
function interpolateMetricsAtZ(sweep: MetricsAtZ[] | undefined, z: number): MetricsAtZ | null {
  if (!sweep?.length) return null
  if (z <= sweep[0].z) return sweep[0]
  if (z >= sweep[sweep.length - 1].z) return sweep[sweep.length - 1]
  let i = 0
  while (i < sweep.length - 1 && sweep[i + 1].z < z) i++
  const a = sweep[i]
  const b = sweep[i + 1]
  const t = (z - a.z) / (b.z - a.z)
  const lerp = (x: number | null, y: number | null) =>
    x != null && y != null ? x + t * (y - x) : x ?? y ?? null
  const rmsPerField =
    a.rmsPerField && b.rmsPerField && a.rmsPerField.length === b.rmsPerField.length
      ? a.rmsPerField.map((av, j) => lerp(av, b.rmsPerField![j]))
      : a.rmsPerField
  return {
    z,
    rmsRadius: lerp(a.rmsRadius, b.rmsRadius),
    beamWidth: lerp(a.beamWidth, b.beamWidth),
    chiefRayAngle: lerp(a.chiefRayAngle, b.chiefRayAngle),
    yCentroid: lerp(a.yCentroid, b.yCentroid),
    numRays: a.numRays,
    rmsPerField,
  }
}

/** System Average RMS (same metric Best Composite minimizes). */
function systemAvgRms(metrics: MetricsAtZ | null): number | null {
  if (!metrics?.rmsPerField?.length) return metrics?.rmsRadius ?? null
  const valid = metrics.rmsPerField.filter((r): r is number => r != null)
  return valid.length > 0 ? Math.sqrt(valid.reduce((s, r) => s + r * r, 0) / valid.length) : null
}

type OpticalViewportProps = {
  className?: string
  systemState: SystemState
  onSystemStateChange: (state: SystemState | ((prev: SystemState) => SystemState)) => void
  selectedSurfaceId: string | null
  onSelectSurface: (id: string | null) => void
  highlightedMetric?: HighlightedMetric
  showPersistentHud?: boolean
  showBestFocus?: boolean
  snapToFocus?: boolean
  snapToSurface?: boolean
  /** Ref to trigger 10-iteration sample analysis from InfoPanel */
  runSampleAnalysisRef?: React.MutableRefObject<(() => void) | null>
  /** Ref to trigger pulse on Optimize Colors button from InfoPanel */
  pulseOptimizeRef?: React.MutableRefObject<(() => void) | null>
  /** Callback when Monte Carlo completes with per-surface sensitivity */
  onMonteCarloSensitivity?: (sensitivity: number[] | null) => void
}

export function OpticalViewport({
  className = '',
  systemState,
  onSystemStateChange,
  selectedSurfaceId,
  onSelectSurface,
  highlightedMetric = null,
  showPersistentHud = false,
  showBestFocus = true,
  snapToFocus = true,
  snapToSurface = true,
  runSampleAnalysisRef,
  pulseOptimizeRef,
  onMonteCarloSensitivity,
}: OpticalViewportProps) {
  const [isTracing, setIsTracing] = useState(false)
  const [isMonteCarloRunning, setIsMonteCarloRunning] = useState(false)
  const [monteCarloResult, setMonteCarloResult] = useState<MonteCarloResponse | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  const [isSpaceHeld, setIsSpaceHeld] = useState(false)
  const [showCausticEnvelope, setShowCausticEnvelope] = useState(false)
  const [showLcaMap, setShowLcaMap] = useState(false)
  const [pulseOptimizeTrigger, setPulseOptimizeTrigger] = useState(0)
  const [fieldFilter, setFieldFilter] = useState<number | null>(null)
  const [hudTab, setHudTab] = useState<'geometry' | 'ultrafast'>('geometry')
  const [hintVisible, setHintVisible] = useState(false)
  const hintLeaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const numFields = (systemState.fieldAngles || [0]).length
  useEffect(() => {
    if (fieldFilter != null && fieldFilter >= numFields) {
      setFieldFilter(null)
    }
  }, [numFields, fieldFilter])

  useEffect(() => {
    if (isPanning) {
      setHintVisible(false)
      if (hintLeaveTimeoutRef.current) {
        clearTimeout(hintLeaveTimeoutRef.current)
        hintLeaveTimeoutRef.current = null
      }
    }
  }, [isPanning])

  useEffect(() => {
    return () => {
      if (hintLeaveTimeoutRef.current) clearTimeout(hintLeaveTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    if (!pulseOptimizeRef) return
    pulseOptimizeRef.current = () => {
      setShowLcaMap(true)
      setPulseOptimizeTrigger((n) => n + 1)
    }
    return () => {
      pulseOptimizeRef.current = null
    }
  }, [pulseOptimizeRef])

  const handleViewportMouseEnter = useCallback(() => {
    if (hintLeaveTimeoutRef.current) {
      clearTimeout(hintLeaveTimeoutRef.current)
      hintLeaveTimeoutRef.current = null
    }
    setHintVisible(true)
  }, [])

  const handleViewportMouseLeave = useCallback(() => {
    hintLeaveTimeoutRef.current = setTimeout(() => {
      hintLeaveTimeoutRef.current = null
      setHintVisible(false)
    }, 2000)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault()
        setIsSpaceHeld(true)
      }
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault()
        setIsSpaceHeld(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])
  const numRays = systemState.numRays
  const hasTraced = systemState.hasTraced
  const traceResult = systemState.traceResult
  const traceError = systemState.traceError

  const setNumRays = (n: number) =>
    onSystemStateChange((prev) => ({ ...prev, numRays: n }))

  const handleTrace = useCallback(async () => {
    setIsTracing(true)
    onSystemStateChange((prev) => ({ ...prev, traceError: null }))
    try {
      const res = await traceOpticalStack({
        surfaces: systemState.surfaces,
        entrancePupilDiameter: systemState.entrancePupilDiameter,
        wavelengths: systemState.wavelengths,
        fieldAngles: systemState.fieldAngles,
        numRays: systemState.numRays,
        focusMode: systemState.focusMode ?? 'On-Axis',
        m2Factor: systemState.m2Factor ?? 1.0,
      })
      if (res.error) {
        onSystemStateChange((prev) => ({
          ...prev,
          hasTraced: true,
          traceResult: null,
          traceError: res.error ?? null,
        }))
      } else {
        if (res.terminationLog?.length) {
          console.warn('[Trace termination log]', res.terminationLog)
        }
        const rawRays = res.rays ?? []
        // Ensure rays go left-to-right (object to image): sort by z ascending.
        // If already sorted, this is a no-op; if reversed (image-to-object), this fixes it.
        const rays = rawRays.map((pts) => [...pts].sort((a, b) => a[0] - b[0]))
        onSystemStateChange((prev) => ({
          ...prev,
          hasTraced: true,
          traceResult: {
            rays,
            rayFieldIndices: res.rayFieldIndices,
            rayPower: res.rayPower,
            surfaces: res.surfaces ?? [],
            focusZ: res.focusZ ?? 0,
            bestFocusZ: res.bestFocusZ,
            zOrigin: res.zOrigin,
            performance: res.performance,
            metricsSweep: res.metricsSweep ?? [],
            gaussianBeam: res.gaussianBeam,
          },
          traceError: null,
        }))
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Trace failed'
      const isNetwork =
        /fetch|network|connection|cors|failed to fetch/i.test(raw) ||
        raw === 'Trace failed'
      const msg = isNetwork
        ? isPyodideEnabled()
          ? `Pyodide worker failed to load. Ensure you're serving from the dist folder: cd dist && npx serve . (or use start-mac.command)`
          : `Cannot reach trace API. Is the backend running? Start it with: uvicorn backend.main:app --reload --port 8000`
        : raw
      onSystemStateChange((prev) => ({
        ...prev,
        hasTraced: true,
        traceResult: null,
        traceError: msg,
      }))
    } finally {
      setIsTracing(false)
    }
  }, [systemState, onSystemStateChange])

  const handleMonteCarlo = useCallback(async (iterations = 100) => {
    const hasTolerances = systemState.surfaces.some(
      (s) => (s.radiusTolerance ?? 0) > 0 || (s.thicknessTolerance ?? 0) > 0 || (s.tiltTolerance ?? 0) > 0
    )
    if (!hasTolerances) {
      onSystemStateChange((prev) => ({ ...prev, traceError: 'Set tolerances (R±, T±, Tilt±) in System Editor first' }))
      return
    }
    setIsMonteCarloRunning(true)
    setMonteCarloResult(null)
    onSystemStateChange((prev) => ({ ...prev, traceError: null }))
    try {
      const res = await runMonteCarlo({
        surfaces: systemState.surfaces,
        entrancePupilDiameter: systemState.entrancePupilDiameter,
        wavelengths: systemState.wavelengths,
        fieldAngles: systemState.fieldAngles,
        numRays: systemState.numRays,
        focusMode: systemState.focusMode ?? 'On-Axis',
        iterations,
      })
      if (res.error) {
        onSystemStateChange((prev) => ({ ...prev, traceError: res.error ?? null }))
        onMonteCarloSensitivity?.(null)
      } else {
        setMonteCarloResult(res)
        onMonteCarloSensitivity?.(res.sensitivityBySurface ?? null)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Monte Carlo failed'
      onSystemStateChange((prev) => ({ ...prev, traceError: msg }))
    } finally {
      setIsMonteCarloRunning(false)
    }
  }, [systemState, onSystemStateChange])

  useEffect(() => {
    if (runSampleAnalysisRef) {
      runSampleAnalysisRef.current = () => handleMonteCarlo(10)
      return () => {
        runSampleAnalysisRef.current = null
      }
    }
  }, [runSampleAnalysisRef, handleMonteCarlo])

  // Clear Monte Carlo result when system changes
  useEffect(() => {
    setMonteCarloResult(null)
    onMonteCarloSensitivity?.(null)
  }, [systemState.surfaces, systemState.entrancePupilDiameter, systemState.numRays, onMonteCarloSensitivity])

  // Run trace when surfaces were reordered (pendingTrace set on drop)
  useEffect(() => {
    if (!systemState.pendingTrace) return
    onSystemStateChange((prev) => ({ ...prev, pendingTrace: false }))
    handleTrace()
  }, [systemState.pendingTrace, onSystemStateChange, handleTrace])

  const viewWidth = config.viewport.width
  const viewHeight = config.viewport.height
  const surfaces = systemState.surfaces
  const epd = systemState.entrancePupilDiameter ?? 10
  const semiHeight = epd / 2

  const { scale, xOffset, cy } = useMemo(
    () =>
      computeViewTransform(
        traceResult,
        surfaces,
        epd,
        viewWidth,
        viewHeight
      ),
    [traceResult, surfaces, epd, viewWidth, viewHeight]
  )

  const zPositions = useMemo(() => computeCumulativeZ(surfaces), [surfaces])
  const totalLength = zPositions.length ? zPositions[zPositions.length - 1] + (surfaces[surfaces.length - 1]?.thickness ?? 0) : 0
  const focusX = totalLength * 0.7
  const lensX1 = zPositions[0] ?? 0
  const lensX2 = surfaces[0] ? (zPositions[0] ?? 0) + (surfaces[0].thickness ?? 0) : 0

  const toSvg = (z: number, y: number) =>
    `${z * scale + xOffset},${cy - y * scale}`

  const causticEnvelopePath = useMemo(() => {
    if (!showCausticEnvelope || !traceResult?.rays?.length) return null
    return computeCausticEnvelope(traceResult.rays, toSvg, 80)
  }, [showCausticEnvelope, traceResult?.rays, scale, xOffset, cy])

  const beamEnvelopePath = useMemo(() => {
    const gb = traceResult?.gaussianBeam
    if (!gb?.beamEnvelope?.length) return null
    const pts = gb.beamEnvelope
    const lower = pts.map(([z, w]) => toSvg(z, -w)).join(' L ')
    const upper = [...pts].reverse().map(([z, w]) => toSvg(z, w)).join(' L ')
    return `M ${lower} L ${upper} Z`
  }, [traceResult?.gaussianBeam, scale, xOffset, cy])

  /** Generate SVG path for a single surface profile at z with given radius and diameter */
  function surfaceProfilePath(
    zPos: number,
    radius: number,
    diameter: number,
    nPts = 24
  ): string {
    const semi = diameter / 2
    const pts: string[] = []
    if (Math.abs(radius) < 0.1) {
      pts.push(toSvg(zPos, -semi))
      pts.push(toSvg(zPos, semi))
    } else {
      const R = radius
      for (let i = 0; i <= nPts; i++) {
        const t = i / nPts
        const y = (t - 0.5) * 2 * semi
        const radicand = Math.max(0, R * R - y * y)
        const zLocal = R - Math.sign(R) * Math.sqrt(radicand)
        const zGlobal = zPos + zLocal
        pts.push(toSvg(zGlobal, y))
      }
    }
    return pts.length >= 2 ? `M ${pts[0]} L ${pts.slice(1).join(' L ')}` : ''
  }

  /** Lens elements (glass/air) and surface outlines. refractiveIndex used for color-coding. */
  const lensElements = useMemo(() => {
    const elements: {
      type: 'glass' | 'air' | 'surface'
      path: string
      key: string
      refractiveIndex: number
      surfaceId: string
    }[] = []
    for (let i = 0; i < surfaces.length; i++) {
      const s = surfaces[i]
      const z = zPositions[i] ?? 0
      const n = s.refractiveIndex ?? 1
      const path = surfaceProfilePath(z, s.radius, s.diameter ?? epd)
      if (path) {
        elements.push({ type: 'surface', path, key: `surf-${i}`, refractiveIndex: n, surfaceId: s.id })
      }
      if (i < surfaces.length - 1) {
        const next = surfaces[i + 1]
        const zNext = zPositions[i + 1] ?? z + s.thickness
        const pathFront = surfaceProfilePath(z, s.radius, s.diameter ?? epd)
        const pathBack = surfaceProfilePath(zNext, next.radius, next.diameter ?? epd)
        if (pathFront && pathBack) {
          const frontPts = pathFront.split(' L ').map((p) => p.replace('M ', ''))
          const backPts = pathBack.split(' L ').map((p) => p.replace('M ', '')).reverse()
          const closed = `M ${frontPts.join(' L ')} L ${backPts.join(' L ')} Z`
          const gapType = n > 1.01 ? 'glass' : 'air'
          elements.push({ type: gapType, path: closed, key: `gap-${i}`, refractiveIndex: n, surfaceId: s.id })
        }
      }
    }
    return elements
  }, [surfaces, zPositions, epd, scale, xOffset, cy])

  /** Thermal heat map: show when power exceeds threshold and first lens has absorption */
  const thermalHeatMapElement = useMemo(() => {
    const threshold = config.thermalPowerThresholdW ?? 1
    const power = systemState.laserPowerW ?? 0
    const firstGlass = surfaces.find((s) => s.type === 'Glass')
    const alpha = firstGlass?.absorptionCoefficient ?? 0
    if (power <= threshold || alpha <= 0) return null
    return lensElements.find((e) => e.type === 'glass' && e.key === 'gap-0') ?? null
  }, [systemState.laserPowerW, surfaces, lensElements])

  // Rays grouped by field angle for robust color inheritance. Each group gets one stroke color.
  const raysByField = useMemo(() => {
    if (!hasTraced) return []
    if (traceResult?.rays?.length) {
      const fieldAngles = systemState.fieldAngles || [0]
      const numFields = Math.max(1, fieldAngles.length)
      const indices = traceResult.rayFieldIndices
      const colors = config.rayColors
      const numGroups = Math.max(1, Math.min(colors.length, indices?.length ? Math.max(...indices) + 1 : numFields))
      const groups: Map<number, Ray[]> = new Map()
      traceResult.rays.forEach((pts, i) => {
        const fieldIndex =
          indices && indices[i] != null
            ? Math.min(indices[i], numGroups - 1)
            : Math.min(Math.floor(i / Math.ceil(traceResult!.rays!.length / numGroups)), numGroups - 1)
        const color = colors[Math.min(fieldIndex, colors.length - 1)]
        const ray: Ray = {
          points: pts.map(([z, y]) => ({ x: z, y })),
          color,
        }
        if (!groups.has(fieldIndex)) groups.set(fieldIndex, [])
        groups.get(fieldIndex)!.push(ray)
      })
      return Array.from(groups.entries())
        .sort(([a], [b]) => a - b)
        .map(([fieldIndex, rays]) => ({
          color: colors[Math.min(fieldIndex, colors.length - 1)],
          rays,
        }))
    }
    const fallbackRays = generateRays(numRays, lensX1, lensX2, focusX, semiHeight)
    return [{ color: config.rayColors[0], rays: fallbackRays }]
  }, [hasTraced, traceResult, numRays, lensX1, lensX2, focusX, semiHeight, systemState.fieldAngles])

  const totalRays = raysByField.reduce((n, g) => n + g.rays.length, 0)

  const bestFocusZ = traceResult?.bestFocusZ
  const bestFocusSvgX = bestFocusZ != null ? bestFocusZ * scale + xOffset : null

  const opticalBounds = useMemo(
    () => computeOpticalBounds(traceResult, surfaces, epd),
    [traceResult, surfaces, epd]
  )

  const svgRef = useRef<SVGSVGElement>(null)
  const focusAlignLogRef = useRef<{ last: number }>({ last: 0 })
  const transformInstanceRef = useRef<{
    transformState: { scale: number; positionX: number; positionY: number }
    contentComponent: HTMLDivElement | null
  } | null>(null)
  const [isAltHeld, setIsAltHeld] = useState(false)
  const [scanHud, setScanHud] = useState<{
    isHovering: boolean
    mouseX: number
    mouseY: number
    cursorSvgX: number
    cursorSvgY: number
    scanSvgX: number
    cursorZ: number
    /** When snapped to a surface, the 0-based surface index; otherwise null */
    snappedSurfaceIndex: number | null
  }>({ isHovering: false, mouseX: 0, mouseY: 0, cursorSvgX: 0, cursorSvgY: 0, scanSvgX: 0, cursorZ: 0, snappedSurfaceIndex: null })

  // Snap override: event.altKey handles both Alt (Win/Linux) and Option (Mac) automatically
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey) setIsAltHeld(true)
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (!e.altKey) setIsAltHeld(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  const handleSvgMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current
      const instance = transformInstanceRef.current
      if (!svg) return

      let cursorSvgX: number
      let cursorSvgY: number

      if (instance?.contentComponent) {
        const rect = instance.contentComponent.getBoundingClientRect()
        const vbW = viewWidth
        const vbH = viewHeight
        const scaleFit = Math.min(rect.width / vbW, rect.height / vbH)
        const renderedW = vbW * scaleFit
        const renderedH = vbH * scaleFit
        const offsetX = (rect.width - renderedW) / 2
        const offsetY = (rect.height - renderedH) / 2
        cursorSvgX = (e.clientX - rect.left - offsetX) / scaleFit
        cursorSvgY = (e.clientY - rect.top - offsetY) / scaleFit
      } else {
        const rect = svg.getBoundingClientRect()
        const vbW = viewWidth
        const vbH = viewHeight
        const scaleFit = Math.min(rect.width / vbW, rect.height / vbH)
        const renderedW = vbW * scaleFit
        const renderedH = vbH * scaleFit
        const offsetX = (rect.width - renderedW) / 2
        const offsetY = (rect.height - renderedH) / 2
        cursorSvgX = (e.clientX - rect.left - offsetX) / scaleFit
        cursorSvgY = (e.clientY - rect.top - offsetY) / scaleFit
      }

      // Default: HUD line follows mouse exactly (Z = mouseZ)
      let scanSvgX = cursorSvgX
      let snappedSurfaceIndex: number | null = null
      let snapType: 'None' | 'Surface' | 'Focus' = 'None'

      // Override: Alt key held → bypass all snapping, Z = mouseZ
      if (!isAltHeld) {
        // Surface Snap: IF snapToSurface ON and mouse within 10px of a surface → Z = surfaceZ
        if (snapToSurface) {
          let bestSurfaceDist = SCAN_SNAP_PX
          for (let i = 0; i < zPositions.length; i++) {
            const targetX = zPositions[i] * scale + xOffset
            const d = Math.abs(cursorSvgX - targetX)
            if (d < bestSurfaceDist) {
              bestSurfaceDist = d
              scanSvgX = targetX
              snappedSurfaceIndex = i
              snapType = 'Surface'
            }
          }
        }

        // Focus Snap: IF snapToFocus ON, NOT surface-snapping, and mouse within 10px of diamond → Z = focusZ
        if (snapType !== 'Surface' && snapToFocus && traceResult?.bestFocusZ != null) {
          const diamondX = traceResult.bestFocusZ * scale + xOffset
          const d = Math.abs(cursorSvgX - diamondX)
          if (d < SCAN_SNAP_PX) {
            scanSvgX = diamondX
            snapType = 'Focus'
          }
        }
      }

      const zCursorPos = (scanSvgX - xOffset) / scale
      if (import.meta.env.DEV) {
        console.log('[HUD Snap]', snapType, '| Z=', zCursorPos.toFixed(3), 'mm')
      }
      if (DEBUG_HUD_COORDS) {
        console.log('[HUD] coord chain: clientX=', e.clientX, '| cursorSvgX (viewBox)=', cursorSvgX.toFixed(1), '| scanSvgX=', scanSvgX.toFixed(1), '| scale=', scale.toFixed(2), 'xOffset=', xOffset.toFixed(1), '→ zCursorPos (optical mm)=', zCursorPos.toFixed(3))
      }
      setScanHud({
        isHovering: true,
        mouseX: e.clientX,
        mouseY: e.clientY,
        cursorSvgX,
        cursorSvgY,
        scanSvgX,
        cursorZ: zCursorPos,
        snappedSurfaceIndex,
      })
    },
    [
      scale,
      xOffset,
      viewWidth,
      viewHeight,
      zPositions, // optical_stack surface Z positions (derived from surfaces)
      traceResult?.bestFocusZ,
      snapToFocus,
      snapToSurface,
      isAltHeld,
    ]
  )

  const handleSvgMouseLeave = useCallback(() => {
    setScanHud((prev) => ({ ...prev, isHovering: false }))
  }, [])

  const handleSvgDoubleClick = useCallback(() => {
    const z = traceResult?.bestFocusZ
    if (z == null || surfaces.length < 2) return
    const totalLength = surfaces.reduce((sum, s) => sum + (s.thickness ?? 0), 0)
    const lastSurface = surfaces[surfaces.length - 1]
    const sumOfRest = totalLength - (lastSurface?.thickness ?? 0)
    const newThickness = Math.max(0.1, z - sumOfRest)
    onSystemStateChange((prev) => ({
      ...prev,
      surfaces: prev.surfaces.map((s, i) =>
        i === prev.surfaces.length - 1 ? { ...s, thickness: newThickness } : s
      ),
      traceResult: null,
      traceError: null,
    }))
  }, [traceResult?.bestFocusZ, surfaces, onSystemStateChange])

  const scanMetrics = scanHud.isHovering
    ? interpolateMetricsAtZ(traceResult?.metricsSweep ?? [], scanHud.cursorZ)
    : null

  if (DEBUG_HUD_COORDS && scanHud.isHovering && scanMetrics) {
    const sweep = traceResult?.metricsSweep ?? []
    const sweepZRange = sweep.length ? `[${sweep[0].z.toFixed(2)}, ${sweep[sweep.length - 1].z.toFixed(2)}] mm` : 'empty'
    console.log('[HUD] zCursorPos (optical mm):', scanHud.cursorZ.toFixed(3), '| RMS:', scanMetrics.rmsRadius != null ? (scanMetrics.rmsRadius * 1000).toFixed(2) + ' µm' : '—', '| sweep Z range:', sweepZRange)
  }

  const persistentHudZ = bestFocusZ ?? traceResult?.focusZ ?? totalLength * 0.8
  const persistentMetrics = showPersistentHud
    ? interpolateMetricsAtZ(traceResult?.metricsSweep ?? [], persistentHudZ)
    : null

  const showHud = scanHud.isHovering || showPersistentHud
  const hudMetrics = scanHud.isHovering ? scanMetrics : persistentMetrics
  const hudZ = scanHud.isHovering ? scanHud.cursorZ : persistentHudZ
  const isPersistentHud = showPersistentHud && !scanHud.isHovering

  const dispersionResult = useMemo(() => {
    const lambda = systemState.wavelengths?.[0] ?? 587.6
    const pulseFs = systemState.pulseWidthFs ?? 100
    return computeDispersion(
      surfaces.map((s) => ({
        thickness: s.thickness,
        material: s.material,
        type: s.type,
        refractiveIndex: s.refractiveIndex,
      })),
      lambda,
      pulseFs
    )
  }, [surfaces, systemState.wavelengths, systemState.pulseWidthFs])

  // Debug: HUD vs Diamond alignment — Diamond_RMS < HUD_RMS => math OK, rendering bug; HUD_RMS < Diamond_RMS => backend search bug
  if (DEBUG_FOCUS_ALIGNMENT && showHud && bestFocusZ != null && traceResult?.metricsSweep?.length) {
    const now = Date.now()
    if (now - focusAlignLogRef.current.last >= 300) {
      focusAlignLogRef.current.last = now
      const HUD_Z = hudZ
      const HUD_RMS = systemAvgRms(hudMetrics)
      const Diamond_Z = bestFocusZ
      const diamondMetrics = interpolateMetricsAtZ(traceResult.metricsSweep, bestFocusZ)
      const Diamond_RMS = systemAvgRms(diamondMetrics)
      console.log('[FocusAlignment]', {
        HUD_Z: HUD_Z.toFixed(4),
        HUD_RMS: HUD_RMS != null ? (HUD_RMS * 1000).toFixed(4) + ' µm' : '—',
        Diamond_Z: Diamond_Z.toFixed(4),
        Diamond_RMS: Diamond_RMS != null ? (Diamond_RMS * 1000).toFixed(4) + ' µm' : '—',
        verdict:
          HUD_RMS != null && Diamond_RMS != null
            ? Diamond_RMS < HUD_RMS
              ? 'Math OK → likely RENDERING offset bug'
              : 'HUD_RMS lower → BACKEND search bug (local min / limited range)'
            : '—',
      })
    }
  }

  return (
    <div className={`relative ${className}`}>
      <div className="absolute top-4 left-4 z-10 flex flex-wrap items-center gap-4 glass-card px-4 py-2 rounded-lg">
        <motion.button
          data-testid="trace-button"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleTrace}
          disabled={isTracing}
          className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all disabled:opacity-70"
            style={{
              background: 'linear-gradient(135deg, #22D3EE 0%, #0891b2 100%)',
              color: '#0B1120',
              boxShadow: '0 0 24px rgba(34, 211, 238, 0.5)',
            }}
          >
            {isTracing ? (
              <Loader2 className="w-5 h-5 animate-spin" strokeWidth={2} />
            ) : (
              <Play className="w-5 h-5" fill="currentColor" strokeWidth={0} />
            )}
            {isTracing ? 'Tracing…' : 'Trace'}
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => handleMonteCarlo()}
          disabled={isMonteCarloRunning}
          title="Run Monte Carlo (100 iterations with tolerance jitter) — set R±, T±, Tilt± in System Editor"
          className="flex items-center gap-2 px-3 py-2 rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed border border-cyan-electric/50 hover:bg-cyan-electric/15 text-cyan-electric"
        >
          {isMonteCarloRunning ? (
            <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} />
          ) : (
            <Dices className="w-4 h-4" strokeWidth={2} />
          )}
          {isMonteCarloRunning ? 'Monte Carlo…' : 'Monte Carlo'}
        </motion.button>
        <div className="flex items-center gap-3">
          <span className="text-slate-400 text-sm whitespace-nowrap">Rays</span>
          <input
            type="range"
            min={config.rayCount.min}
            max={config.rayCount.max}
            value={numRays}
            onChange={(e) => setNumRays(Number(e.target.value))}
            className="w-28 h-2 rounded-full accent-cyan-electric bg-white/10 cursor-pointer"
          />
          <span className="text-cyan-electric text-sm font-mono w-6">{numRays}</span>
        </div>
        {hasTraced && (
          <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-300">
            <input
              type="checkbox"
              checked={showCausticEnvelope}
              onChange={(e) => setShowCausticEnvelope(e.target.checked)}
              className="rounded accent-cyan-electric"
            />
            Caustic Envelope
          </label>
        )}
        <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-300">
          <input
            type="checkbox"
            checked={showLcaMap}
            onChange={(e) => setShowLcaMap(e.target.checked)}
            className="rounded accent-cyan-electric"
          />
          <LineChart className="w-4 h-4 text-slate-400" strokeWidth={2} />
          Show LCA Map
        </label>
        {hasTraced && (
          <div className="flex items-center gap-2">
            <span className="text-slate-400 text-sm whitespace-nowrap">Field</span>
            <div className="flex items-center gap-1.5">
              {(systemState.fieldAngles || [0]).slice(0, config.rayColors.length).map((_, fIdx) => {
                const color = config.rayColors[Math.min(fIdx, config.rayColors.length - 1)]
                const isActive = fieldFilter === fIdx
                return (
                  <button
                    key={fIdx}
                    type="button"
                    onClick={() => setFieldFilter(fieldFilter === fIdx ? null : fIdx)}
                    title={
                      fieldFilter === fIdx
                        ? 'Show all fields'
                        : `Show only field ${fIdx}${(systemState.fieldAngles || [])[fIdx] != null ? ` (${(systemState.fieldAngles || [])[fIdx]}°)` : ''}`
                    }
                    className={`w-3 h-3 rounded-full transition-all ring-offset-2 ring-offset-slate-900 ${
                      isActive ? 'ring-2 ring-white scale-125' : 'ring-0 hover:scale-110 opacity-80 hover:opacity-100'
                    }`}
                    style={{
                      backgroundColor: color,
                      boxShadow: isActive ? `0 0 6px ${color}` : undefined,
                    }}
                    aria-label={`Filter to field ${fIdx}`}
                    aria-pressed={isActive}
                  />
                )
              })}
            </div>
          </div>
        )}
      </div>

      {traceError && (
        <div className="absolute top-4 right-4 z-20 glass-card px-4 py-3 rounded-lg text-red-400 text-sm max-w-sm border border-red-500/30 bg-slate-900/95">
          <p className="font-medium text-red-300 mb-1">Trace error</p>
          <p className="text-red-200/90">{traceError}</p>
          <button
            type="button"
            onClick={() => onSystemStateChange((prev) => ({ ...prev, traceError: null }))}
            className="mt-2 text-xs text-slate-400 hover:text-slate-200 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <AnimatePresence>
        {isTracing && (
          <div
            className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
            aria-live="polite"
          >
            <motion.div
              key="calculating"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="glass-card px-4 py-2 rounded-lg flex items-center gap-2 text-cyan-electric/90 text-sm"
            >
              <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} />
              <span>Calculating…</span>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div
        className="relative overflow-hidden rounded-xl"
        style={{
          backgroundColor: '#0B1120',
          border: '1px solid rgba(34, 211, 238, 0.2)',
        }}
        onMouseEnter={handleViewportMouseEnter}
        onMouseLeave={handleViewportMouseLeave}
      >
        {showLcaMap && (
          <ChromaticAberrationOverlay
            systemState={systemState}
            onSystemStateChange={onSystemStateChange}
            pulseOptimizeTrigger={pulseOptimizeTrigger}
          />
        )}
        <TransformWrapper
          initialScale={1}
          minScale={0.1}
          maxScale={20}
          centerOnInit
          limitToBounds={false}
          smooth
          wheel={{
            step: 0.15,
            smoothStep: 0.002,
            wheelDisabled: false,
            touchPadDisabled: false,
          }}
          panning={{
            disabled: false,
            velocityDisabled: true,
            allowLeftClickPan: true,
            allowMiddleClickPan: true,
            allowRightClickPan: false,
            activationKeys: [' '],
            excluded: [],
          }}
          onPanningStart={() => setIsPanning(true)}
          onPanningStop={() => setIsPanning(false)}
          zoomAnimation={{
            animationTime: 200,
            animationType: 'easeOut',
          }}
          doubleClick={{ disabled: true }}
        >
          {({ zoomIn, zoomOut, centerView, instance }) => {
            transformInstanceRef.current = instance
              ? {
                  transformState: instance.transformState,
                  contentComponent: instance.contentComponent,
                }
              : null
            const handleResetView = () => {
              const wrapper = instance?.wrapperComponent
              if (!wrapper) return
              const w = wrapper.offsetWidth
              const h = wrapper.offsetHeight
              const padding = 0.1
              const opticalWidthSvg = opticalBounds.zRange * scale
              const opticalHeightSvg = 2 * opticalBounds.yExtent * scale
              const fitScale = Math.min(
                (w * (1 - 2 * padding)) / opticalWidthSvg,
                (h * (1 - 2 * padding)) / opticalHeightSvg
              )
              centerView(fitScale, 450, 'easeOutCubic')
            }
            return (
              <>
          <TransformComponent
            wrapperStyle={{
              width: '100%',
              height: '100%',
              minHeight: '320px',
              cursor: isPanning ? 'grabbing' : isSpaceHeld ? 'grab' : 'default',
            }}
            contentStyle={{ width: '100%', height: '100%', minHeight: '320px' }}
          >
            <svg
              ref={svgRef}
              viewBox={`0 0 ${viewWidth} ${viewHeight}`}
              className="w-full h-full min-h-[320px] block"
              preserveAspectRatio="xMidYMid meet"
              onMouseEnter={handleSvgMouseMove}
              onMouseMove={handleSvgMouseMove}
              onMouseLeave={handleSvgMouseLeave}
              onDoubleClick={handleSvgDoubleClick}
            >
              <defs>
                <pattern
                  id="infinite-grid"
                  width={GRID_SIZE}
                  height={GRID_SIZE}
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d={`M ${GRID_SIZE} 0 L 0 0 0 ${GRID_SIZE}`}
                    fill="none"
                    stroke="#22D3EE"
                    strokeWidth="0.5"
                    opacity="0.12"
                  />
                </pattern>
                <filter id="lens-glow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="2" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
                <filter id="glow-strong" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
                <filter id="diamond-glow" x="-100%" y="-100%" width="300%" height="300%">
                  <feGaussianBlur stdDeviation="2" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
                <linearGradient id="lens-fill" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#22D3EE" stopOpacity="0.15" />
                  <stop offset="50%" stopColor="#22D3EE" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#22D3EE" stopOpacity="0.15" />
                </linearGradient>
                <linearGradient id="caustic-envelope-fill" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#22D3EE" stopOpacity="0.08" />
                  <stop offset="50%" stopColor="#22D3EE" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#22D3EE" stopOpacity="0.08" />
                </linearGradient>
                {/* Thermal heat map: center hot (orange/red), edges cool — for high-power CW laser lens warping */}
                <radialGradient
                  id="thermal-heat-map"
                  cx="50%"
                  cy="50%"
                  r="50%"
                  gradientUnits="objectBoundingBox"
                >
                  <stop offset="0%" stopColor="#f97316" stopOpacity="0.9" />
                  <stop offset="40%" stopColor="#ea580c" stopOpacity="0.5" />
                  <stop offset="70%" stopColor="#dc2626" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="#7f1d1d" stopOpacity="0" />
                </radialGradient>
              </defs>

              <rect
                x={-GRID_EXTENT}
                y={-GRID_EXTENT}
                width={GRID_EXTENT * 2}
                height={GRID_EXTENT * 2}
                fill="url(#infinite-grid)"
              />

          {causticEnvelopePath && (
            <path
              d={causticEnvelopePath}
              fill="url(#caustic-envelope-fill)"
              stroke="rgba(34, 211, 238, 0.4)"
              strokeWidth="0.5"
              opacity="0.6"
              pointerEvents="none"
            />
          )}

          {beamEnvelopePath && (
            <path
              d={beamEnvelopePath}
              fill="rgba(34, 211, 238, 0.15)"
              stroke="rgba(34, 211, 238, 0.5)"
              strokeWidth="1"
              opacity="0.9"
              pointerEvents="none"
            />
          )}

          <g filter="url(#lens-glow)">
            {lensElements.map((el) => {
              const isSelected = selectedSurfaceId === el.surfaceId
              const handleClick = (e: React.MouseEvent) => {
                e.stopPropagation()
                onSelectSurface(el.surfaceId)
              }
              if (el.type === 'glass') {
                return (
                  <path
                    key={el.key}
                    d={el.path}
                    fill={isSelected ? 'rgba(34, 211, 238, 0.3)' : 'rgba(34, 211, 238, 0.2)'}
                    stroke="#22D3EE"
                    strokeWidth={isSelected ? 2 : 1.5}
                    strokeOpacity={isSelected ? 1 : 0.8}
                    strokeDasharray={isSelected ? '4 2' : undefined}
                    style={{
                      filter: isSelected
                        ? 'drop-shadow(0 0 12px rgba(34, 211, 238, 0.8))'
                        : 'drop-shadow(0 0 6px rgba(34, 211, 238, 0.4))',
                      cursor: 'pointer',
                    }}
                    onClick={handleClick}
                  />
                )
              }
              if (el.type === 'air') {
                return (
                  <path
                    key={el.key}
                    d={el.path}
                    fill={isSelected ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.03)'}
                    stroke={isSelected ? '#22D3EE' : 'rgba(148, 163, 184, 0.4)'}
                    strokeWidth={isSelected ? 1.5 : 1}
                    strokeOpacity={isSelected ? 0.9 : 0.6}
                    strokeDasharray={isSelected ? '4 2' : undefined}
                    style={{ cursor: 'pointer' }}
                    onClick={handleClick}
                  />
                )
              }
              return (
                <path
                  key={el.key}
                  d={el.path}
                  fill="none"
                  stroke="#22D3EE"
                  strokeWidth={isSelected ? 2 : 1.5}
                  strokeOpacity={isSelected ? 1 : 0.8}
                  strokeDasharray={isSelected ? '4 2' : undefined}
                  style={{
                    filter: isSelected
                      ? 'drop-shadow(0 0 10px rgba(34, 211, 238, 0.9))'
                      : undefined,
                    cursor: 'pointer',
                  }}
                  onClick={handleClick}
                />
              )
            })}
          </g>

          {thermalHeatMapElement && (
            <path
              d={thermalHeatMapElement.path}
              fill="url(#thermal-heat-map)"
              stroke="none"
              opacity={0.6}
              pointerEvents="none"
            />
          )}

          {raysByField
            .map((group, origIdx) => ({ group, origIdx }))
            .filter(({ origIdx }) => fieldFilter === null || origIdx === fieldFilter)
            .map(({ group, origIdx }) => (
            <g
              key={origIdx}
              stroke={group.color}
              strokeWidth="0.75"
              strokeOpacity="0.8"
              fill="none"
              style={{ filter: `drop-shadow(0 0 1px ${group.color}40)` }}
            >
              {group.rays.map((ray, rayIdx) => {
                // Draw rays left-to-right (object→image). Reverse if trace returns image-to-object order.
                const pts = ray.points
                const ordered = pts[0]?.x <= pts[pts.length - 1]?.x ? pts : [...pts].reverse()
                const d = ordered
                  .map((p, j) => `${j === 0 ? 'M' : 'L'} ${toSvg(p.x, p.y)}`)
                  .join(' ')
                const globalIdx = raysByField
                  .slice(0, origIdx)
                  .reduce((n, g) => n + g.rays.length, 0) + rayIdx
                return (
                  <motion.path
                    key={`field-${origIdx}-ray-${rayIdx}`}
                    d={d}
                    fill="none"
                    initial={{ pathLength: 0, opacity: 0 }}
                    animate={
                      isTracing
                        ? { pathLength: 1, opacity: [0.5, 1, 0.5] }
                        : { pathLength: 1, opacity: 0.8 }
                    }
                    transition={
                      isTracing
                        ? { opacity: { duration: 0.8, repeat: Infinity, ease: 'easeInOut' } }
                        : { duration: 0.6, delay: globalIdx * 0.03 }
                    }
                  />
                )
              })}
            </g>
          ))}

          {/* Monte Carlo spot diagram (point cloud) at image plane */}
          {monteCarloResult?.spots?.length && bestFocusSvgX != null && (() => {
            const spotScale = 60
            const cx_spot = bestFocusSvgX + 56
            const cy_spot = cy
            const { dots } = renderMonteCarloCloud(monteCarloResult.spots, {
              centerX: cx_spot,
              centerY: cy_spot,
              scale: spotScale,
              dotRadius: 1.2,
              inSpecOpacity: 0.5,
              outlierOpacity: 0.6,
            })
            return (
              <g key="monte-carlo-spot">
                <defs>
                  <clipPath id="spot-diagram-clip">
                    <rect x={bestFocusSvgX + 12} y={cy - 44} width={88} height={88} rx={4} />
                  </clipPath>
                </defs>
                <rect
                  x={bestFocusSvgX + 12}
                  y={cy - 44}
                  width={88}
                  height={88}
                  rx={4}
                  fill="rgba(15, 23, 42, 0.85)"
                  stroke="rgba(34, 211, 238, 0.5)"
                  strokeWidth="1"
                />
                <g clipPath="url(#spot-diagram-clip)">{dots}</g>
                <text
                  x={bestFocusSvgX + 56}
                  y={cy - 32}
                  textAnchor="middle"
                  fill="#94a3b8"
                  fontSize={9}
                >
                  {`Spot (n=${monteCarloResult.numValid ?? 0})`}
                </text>
                <text
                  x={bestFocusSvgX + 56}
                  y={cy + 38}
                  textAnchor="middle"
                  fill="#22D3EE"
                  fontSize={9}
                >
                  {`RMS ${((monteCarloResult.rmsSpread ?? 0) * 1000).toFixed(2)} µm`}
                </text>
              </g>
            )
          })()}

          <AnimatePresence>
            {showBestFocus && bestFocusSvgX != null && hasTraced && totalRays > 0 && (
              <motion.g
                key="focus-diamond"
                initial={{ x: bestFocusSvgX, y: cy, opacity: 0, scale: 0 }}
                animate={{ x: bestFocusSvgX, y: cy, opacity: 1, scale: 1 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                exit={{
                  x: bestFocusSvgX,
                  y: cy,
                  opacity: 0,
                  scale: 0,
                  transition: { duration: 0.2 },
                }}
                style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
              >
                {/* Diamond centered at (0,0) for bulletproof scale-from-center */}
                <polygon
                  points="0,-6 6,0 0,6 -6,0"
                  fill={systemState.focusMode === 'Balanced' ? '#F59E0B' : 'white'}
                  stroke={systemState.focusMode === 'Balanced' ? 'rgba(245,158,11,0.95)' : 'rgba(255,255,255,0.9)'}
                  strokeWidth="1"
                  filter="url(#diamond-glow)"
                />
              </motion.g>
            )}
          </AnimatePresence>

          {scanHud.isHovering && (
            <>
              <motion.g
                key={scanHud.snappedSurfaceIndex != null ? `snapped-${scanHud.snappedSurfaceIndex}` : 'free'}
                x={scanHud.scanSvgX}
                initial={false}
                animate={
                  scanHud.snappedSurfaceIndex != null
                    ? {
                        x: [
                          scanHud.scanSvgX,
                          scanHud.scanSvgX + 1,
                          scanHud.scanSvgX - 1,
                          scanHud.scanSvgX,
                        ],
                        transition: { duration: 0.15 },
                      }
                    : { x: scanHud.scanSvgX }
                }
              >
                <line
                  x1={0}
                  y1={0}
                  x2={0}
                  y2={viewHeight}
                  stroke={scanHud.snappedSurfaceIndex != null ? '#ffffff' : '#22D3EE'}
                  strokeWidth="1"
                  strokeDasharray="4 4"
                  strokeOpacity="0.8"
                  pointerEvents="none"
                />
              </motion.g>
              {/* Debug circle: verifies mouse→SVG coordinate transform (remove when verified) */}
              <circle
                cx={scanHud.cursorSvgX}
                cy={scanHud.cursorSvgY}
                r="8"
                fill="none"
                stroke="#f97316"
                strokeWidth="2"
                opacity="0.9"
                pointerEvents="none"
              />
            </>
          )}
        </svg>
          </TransformComponent>

          <motion.div
            className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 glass-card px-3 py-2 rounded-lg"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          >
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => zoomIn()}
              className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors hover:bg-white/10"
              aria-label="Zoom In"
            >
              <ZoomIn className="w-5 h-5 text-cyan-electric" strokeWidth={2} />
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => zoomOut()}
              className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors hover:bg-white/10"
              aria-label="Zoom Out"
            >
              <ZoomOut className="w-5 h-5 text-cyan-electric" strokeWidth={2} />
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleResetView}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-cyan-electric transition-colors hover:bg-white/10"
              aria-label="Reset View"
            >
              <Maximize2 className="w-4 h-4" strokeWidth={2} />
              Reset View
            </motion.button>
          </motion.div>

          {monteCarloResult?.spots?.length && (
            <motion.div
              className="absolute bottom-4 right-4 z-[5] px-3 py-2 rounded-lg text-xs pointer-events-none bg-slate-900/70 backdrop-blur-md border border-cyan-electric/30"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="font-medium text-cyan-electric/90 mb-1.5">Monte Carlo Yield Map</div>
              <div className="flex items-center gap-3 text-slate-400">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-cyan-electric/60" />
                  Within 1σ
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-red-500/80" />
                  Outliers
                </span>
              </div>
            </motion.div>
          )}

          <motion.div
            className="absolute bottom-0 left-0 z-[5] ml-5 mb-5 px-4 py-2 rounded-full text-xs text-slate-300 pointer-events-none bg-slate-900/50 backdrop-blur-[8px] border border-white/10"
            initial={{ opacity: 0, x: -20 }}
            animate={{
              opacity: hintVisible ? 1 : 0,
              x: hintVisible ? 0 : -20,
            }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
          >
            Hold <kbd
              className={`px-1.5 py-0.5 rounded font-mono text-[10px] transition-all duration-150 ${
                isSpaceHeld
                  ? 'bg-cyan-500/30 text-cyan-200 shadow-[0_0_8px_rgba(34,211,238,0.5),0_1px_0_0_rgba(255,255,255,0.15)]'
                  : 'bg-slate-800/90 text-slate-200 shadow-[0_1px_0_0_rgba(255,255,255,0.1),inset_0_-1px_0_0_rgba(0,0,0,0.3)]'
              }`}
            >Space</kbd> + Drag to Pan
          </motion.div>

          {showHud && (
            <motion.div
              className={`z-50 rounded-lg px-3 py-2 backdrop-blur-[12px] bg-slate-900/70 border ${
                scanHud.snappedSurfaceIndex != null ? 'border-white/60' : 'border-cyan-electric/50'
              } ${isPersistentHud ? 'absolute bottom-20 left-4' : 'fixed'}`}
              style={{
                fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
                ...(isPersistentHud ? {} : { left: scanHud.mouseX + 16, top: scanHud.mouseY + 16 }),
              }}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 20 }}
              exit={{ opacity: 0, scale: 0.95 }}
            >
              <div className="flex gap-1 mb-2 border-b border-white/10 pb-2" style={{ pointerEvents: isPersistentHud ? 'auto' : 'none' }}>
                <button
                  type="button"
                  onClick={() => setHudTab('geometry')}
                  className={`px-2 py-1 rounded text-xs font-medium transition-colors ${hudTab === 'geometry' ? 'bg-cyan-electric/40 text-cyan-electric' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  Geometry
                </button>
                <button
                  type="button"
                  onClick={() => setHudTab('ultrafast')}
                  className={`px-2 py-1 rounded text-xs font-medium transition-colors ${hudTab === 'ultrafast' ? 'bg-cyan-electric/40 text-cyan-electric' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  Ultrafast
                </button>
              </div>
              {hudTab === 'ultrafast' ? (
                <div className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-xs pointer-events-none">
                  <HudRow label="GDD:" value={`${dispersionResult.gddFs2.toFixed(2)} fs²`} metricId="gdd" highlightedMetric={highlightedMetric} labelColor="#22D3EE" />
                  <HudRow label="TOD:" value={`${dispersionResult.todFs3.toFixed(2)} fs³`} metricId="tod" highlightedMetric={highlightedMetric} labelColor="#22D3EE" />
                  <div className="col-span-2 flex justify-between gap-2 border-t border-white/10 mt-1 pt-1">
                    <span className="text-slate-400">Input Pulse:</span>
                    <span className="text-slate-300 tabular-nums">{systemState.pulseWidthFs ?? 100} fs</span>
                  </div>
                  <div className="col-span-2 flex justify-between gap-2">
                    <span className="text-slate-400 font-medium">Predicted Exit Pulse:</span>
                    <span className="text-cyan-electric tabular-nums font-medium">
                      {dispersionResult.predictedExitPulseWidthFs.toFixed(2)} fs
                    </span>
                  </div>
                </div>
              ) : (
                <>
              {scanHud.snappedSurfaceIndex != null && !isPersistentHud && (() => {
                const s = surfaces[scanHud.snappedSurfaceIndex!]
                const label = s
                  ? s.description || s.material || (s.type === 'Glass' ? 'Lens' : 'Air')
                  : `Surface ${scanHud.snappedSurfaceIndex! + 1}`
                return (
                  <div className="text-[10px] font-medium text-white/90 mb-1.5 -mt-0.5">
                    Surface {scanHud.snappedSurfaceIndex! + 1}: {label}
                  </div>
                )
              })()}
              <div className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-xs">
                <HudRow label="Z:" value={`${hudMetrics ? hudMetrics.z.toFixed(2) : hudZ.toFixed(2)} mm`} metricId="z" highlightedMetric={highlightedMetric} />
                {hudMetrics?.rmsPerField && hudMetrics.rmsPerField.length > 0 ? (
                  <>
                    {hudMetrics.rmsPerField.map((rms, fi) => {
                      const fieldLabels = ['Cyan RMS', 'Orange RMS', 'Green RMS']
                      const fieldColors = ['#22D3EE', '#F97316', '#22C55E']
                      const label = fieldLabels[Math.min(fi, fieldLabels.length - 1)]
                      const color = fieldColors[Math.min(fi, fieldColors.length - 1)]
                      return (
                        <HudRow
                          key={fi}
                          label={`${label}:`}
                          value={rms != null ? `${(rms * 1000).toFixed(2)} µm` : '—'}
                          metricId="rms"
                          highlightedMetric={highlightedMetric}
                          labelColor={color}
                        />
                      )
                    })}
                    {(() => {
                      const valid = hudMetrics.rmsPerField.filter((r): r is number => r != null)
                      const sysAvg =
                        valid.length > 0
                          ? Math.sqrt(valid.reduce((s, r) => s + r * r, 0) / valid.length)
                          : null
                      return (
                        <div className="col-span-2 flex justify-between gap-2 border-t border-white/10 mt-1 pt-1">
                          <span className="text-slate-400 font-medium">System Avg RMS:</span>
                          <span className="text-amber-400 tabular-nums font-medium">
                            {sysAvg != null ? `${(sysAvg * 1000).toFixed(2)} µm` : '—'}
                          </span>
                        </div>
                      )
                    })()}
                  </>
                ) : (
                  <HudRow
                    label="RMS:"
                    value={hudMetrics?.rmsRadius != null ? `${(hudMetrics.rmsRadius * 1000).toFixed(2)} µm` : '—'}
                    metricId="rms"
                    highlightedMetric={highlightedMetric}
                  />
                )}
                <HudRow label="Width:" value={hudMetrics?.beamWidth != null ? `${hudMetrics.beamWidth.toFixed(3)} mm` : '—'} metricId="beamWidth" highlightedMetric={highlightedMetric} />
                <HudRow label="CRA:" value={hudMetrics?.chiefRayAngle != null ? `${hudMetrics.chiefRayAngle.toFixed(2)}°` : '—'} metricId="cra" highlightedMetric={highlightedMetric} />
                {bestFocusZ != null && (
                  <div className="col-span-2 flex gap-2">
                    <span className="text-slate-400">Dist to Best Focus:</span>
                    <span className="text-cyan-electric tabular-nums">
                      {Math.abs(hudZ - bestFocusZ).toFixed(2)} mm
                    </span>
                  </div>
                )}
                {traceResult?.gaussianBeam && (
                  <>
                    <HudRow
                      label="Spot Size (w₀):"
                      value={`${(traceResult.gaussianBeam.spotSizeAtFocus * 1000).toFixed(2)} µm`}
                      metricId="spotSize"
                      highlightedMetric={highlightedMetric}
                      labelColor="#22D3EE"
                    />
                    <HudRow
                      label="Rayleigh Range (z_R):"
                      value={`${traceResult.gaussianBeam.rayleighRange.toFixed(2)} mm`}
                      metricId="rayleigh"
                      highlightedMetric={highlightedMetric}
                      labelColor="#22D3EE"
                    />
                  </>
                )}
                {traceResult?.metricsSweep?.length && (
                  <>
                    <div className="col-span-2 mt-1.5 pt-1.5 border-t border-white/10">
                      <div className="text-[10px] text-slate-500 mb-0.5">RMS vs Z</div>
                      <RmsVsZGraph
                        sweep={traceResult.metricsSweep}
                        currentZ={hudZ}
                        width={120}
                        height={40}
                      />
                    </div>
                    <div className="col-span-2 mt-1 pt-1 border-t border-white/10">
                      <div className="text-[10px] text-slate-500 mb-0.5">
                        Through-Focus (10 mm) — gold line = diamond minimum
                      </div>
                      <ThroughFocusSparkline
                        sweep={traceResult.metricsSweep}
                        cursorZ={hudZ}
                        diamondZ={bestFocusZ ?? null}
                        width={140}
                        height={44}
                      />
                    </div>
                  </>
                )}
              </div>
                </>
              )}
            </motion.div>
          )}
            </>
            )
          }}
        </TransformWrapper>
      </div>
    </div>
  )
}
