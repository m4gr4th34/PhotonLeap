import { useMemo, useState, useCallback, useEffect, useRef } from 'react'

/** Debug: log HUD z (optical mm) and RMS. Set true to diagnose HUD/line disconnect. */
const DEBUG_HUD_COORDS = import.meta.env.DEV
import { motion } from 'framer-motion'
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'
import { Play, Loader2, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'
import type { SystemState, TraceResult, MetricsAtZ } from '../types/system'
import type { HighlightedMetric } from '../types/ui'
import { traceOpticalStack } from '../api/trace'
import { config } from '../config'

/** Mini RMS vs Z graph for HUD — shows curve and current cursor Z. */
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
  const rmsVals = sweep.map((p) => p.rmsRadius).filter((r): r is number => r != null)
  const rmsMax = Math.max(...rmsVals, 1e-6)
  const pad = 2
  const w = width - 2 * pad
  const h = height - 2 * pad
  const pts = sweep
    .filter((p) => p.rmsRadius != null)
    .map((p) => {
      const x = pad + (w * (p.z - zMin)) / zRange
      const y = pad + h - (h * (p.rmsRadius! / rmsMax))
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
const SCAN_SNAP_PX = 5

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

type OpticalViewportProps = {
  className?: string
  systemState: SystemState
  onSystemStateChange: (state: SystemState | ((prev: SystemState) => SystemState)) => void
  selectedSurfaceId: string | null
  onSelectSurface: (id: string | null) => void
  highlightedMetric?: HighlightedMetric
  showPersistentHud?: boolean
}

export function OpticalViewport({
  className = '',
  systemState,
  onSystemStateChange,
  selectedSurfaceId,
  onSelectSurface,
  highlightedMetric = null,
  showPersistentHud = false,
}: OpticalViewportProps) {
  const [isTracing, setIsTracing] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  const [isSpaceHeld, setIsSpaceHeld] = useState(false)
  const [showCausticEnvelope, setShowCausticEnvelope] = useState(false)

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
      })
      if (res.error) {
        onSystemStateChange((prev) => ({
          ...prev,
          hasTraced: true,
          traceResult: null,
          traceError: res.error ?? null,
        }))
      } else {
        onSystemStateChange((prev) => ({
          ...prev,
          hasTraced: true,
          traceResult: {
            rays: res.rays ?? [],
            surfaces: res.surfaces ?? [],
            focusZ: res.focusZ ?? 0,
            bestFocusZ: res.bestFocusZ,
            zOrigin: res.zOrigin,
            performance: res.performance,
            metricsSweep: res.metricsSweep ?? [],
          },
          traceError: null,
        }))
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Trace failed'
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

  // Rays: backend data or paraxial fallback. Colors by field index (cyan=on-axis, orange=mid, green=edge).
  const rays = useMemo(() => {
    if (!hasTraced) return []
    if (traceResult?.rays?.length) {
      const fieldAngles = systemState.fieldAngles || [0]
      const numFields = Math.max(1, fieldAngles.length)
      const raysPerField = Math.ceil(traceResult.rays.length / numFields)
      const colors = config.rayColors
      return traceResult.rays.map((pts, i) => {
        const fieldIndex = Math.min(Math.floor(i / raysPerField), numFields - 1)
        const color = colors[Math.min(fieldIndex, colors.length - 1)]
        return {
          points: pts.map(([z, y]) => ({ x: z, y })),
          color,
        }
      })
    }
    return generateRays(numRays, lensX1, lensX2, focusX, semiHeight)
  }, [hasTraced, traceResult, numRays, lensX1, lensX2, focusX, semiHeight, systemState.fieldAngles])

  const focusSvgX = traceResult?.focusZ != null
    ? traceResult.focusZ * scale + xOffset
    : focusX * scale + xOffset

  const bestFocusZ = traceResult?.bestFocusZ
  const bestFocusSvgX = bestFocusZ != null ? bestFocusZ * scale + xOffset : null

  const opticalBounds = useMemo(
    () => computeOpticalBounds(traceResult, surfaces, epd),
    [traceResult, surfaces, epd]
  )

  const svgRef = useRef<SVGSVGElement>(null)
  const transformInstanceRef = useRef<{
    transformState: { scale: number; positionX: number; positionY: number }
    contentComponent: HTMLDivElement | null
  } | null>(null)
  const [scanHud, setScanHud] = useState<{
    isHovering: boolean
    mouseX: number
    mouseY: number
    cursorSvgX: number
    cursorSvgY: number
    scanSvgX: number
    cursorZ: number
  }>({ isHovering: false, mouseX: 0, mouseY: 0, cursorSvgX: 0, cursorSvgY: 0, scanSvgX: 0, cursorZ: 0 })

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

      const snapTargetsZ = [...zPositions]
      if (traceResult?.focusZ != null) snapTargetsZ.push(traceResult.focusZ)
      const snapTargetsSvgX = snapTargetsZ.map((z) => z * scale + xOffset)
      let scanSvgX = cursorSvgX
      let bestDist = SCAN_SNAP_PX
      for (const targetX of snapTargetsSvgX) {
        const d = Math.abs(cursorSvgX - targetX)
        if (d < bestDist) {
          bestDist = d
          scanSvgX = targetX
        }
      }
      // Optical Z (mm) = (SVG X - xOffset) / scale — NOT screen pixels; SVG X is in viewBox units
      const zCursorPos = (scanSvgX - xOffset) / scale
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
      })
    },
    [scale, xOffset, viewWidth, viewHeight, zPositions, traceResult?.focusZ]
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

  return (
    <div className={`relative ${className}`}>
      <div className="absolute top-4 left-4 z-10 flex flex-wrap items-center gap-4 glass-card px-4 py-2 rounded-lg">
        <motion.button
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
      </div>

      {traceError && (
        <div className="absolute top-4 right-4 z-10 glass-card px-4 py-2 rounded-lg text-red-400 text-sm max-w-xs">
          {traceError}
        </div>
      )}

      <div
        className="relative overflow-hidden rounded-xl"
        style={{
          backgroundColor: '#0B1120',
          border: '1px solid rgba(34, 211, 238, 0.2)',
        }}
      >
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

          {rays.map((ray, i) => {
            const d = ray.points
              .map((p, j) => `${j === 0 ? 'M' : 'L'} ${toSvg(p.x, p.y)}`)
              .join(' ')
            return (
              <motion.path
                key={i}
                d={d}
                fill="none"
                stroke={ray.color}
                strokeWidth="1.2"
                strokeOpacity="0.9"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 0.9 }}
                transition={{ duration: 0.6, delay: i * 0.03 }}
                style={{ filter: `drop-shadow(0 0 2px ${ray.color})` }}
              />
            )
          })}

          {hasTraced && rays.length > 0 && (
            <motion.circle
              cx={focusSvgX}
              cy={cy}
              r="4"
              fill="#22D3EE"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.5 }}
              filter="url(#glow-strong)"
            />
          )}

          {bestFocusSvgX != null && hasTraced && rays.length > 0 && (
            <g transform={`translate(${bestFocusSvgX}, ${cy})`}>
              <motion.g
                initial={{ opacity: 0, scale: 0 }}
                animate={{
                  opacity: 1,
                  scale: [1, 1.2, 1],
                }}
                transition={{
                  opacity: { duration: 0.3, delay: 0.6 },
                  scale: {
                    duration: 2.2,
                    repeat: Infinity,
                    repeatType: 'reverse',
                  },
                }}
              >
                <polygon
                  points="0,-6 6,0 0,6 -6,0"
                  fill={systemState.focusMode === 'Balanced' ? '#F59E0B' : 'white'}
                  stroke={systemState.focusMode === 'Balanced' ? 'rgba(245,158,11,0.95)' : 'rgba(255,255,255,0.9)'}
                  strokeWidth="1"
                  filter="url(#diamond-glow)"
                />
              </motion.g>
            </g>
          )}

          {scanHud.isHovering && (
            <>
              <line
                x1={scanHud.scanSvgX}
                y1={0}
                x2={scanHud.scanSvgX}
                y2={viewHeight}
                stroke="#22D3EE"
                strokeWidth="1"
                strokeDasharray="4 4"
                strokeOpacity="0.8"
                pointerEvents="none"
              />
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

          {showHud && (
            <motion.div
              className={`pointer-events-none z-50 rounded-lg px-3 py-2 backdrop-blur-[12px] bg-slate-900/70 border border-cyan-electric/50 ${
                isPersistentHud ? 'absolute bottom-20 left-4' : 'fixed'
              }`}
              style={{
                fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
                ...(isPersistentHud ? {} : { left: scanHud.mouseX + 16, top: scanHud.mouseY + 16 }),
              }}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 20 }}
              exit={{ opacity: 0, scale: 0.95 }}
            >
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
                {traceResult?.metricsSweep?.length && (
                  <div className="col-span-2 mt-1.5 pt-1.5 border-t border-white/10">
                    <div className="text-[10px] text-slate-500 mb-0.5">RMS vs Z</div>
                    <RmsVsZGraph
                      sweep={traceResult.metricsSweep}
                      currentZ={hudZ}
                      width={120}
                      height={40}
                    />
                  </div>
                )}
              </div>
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
