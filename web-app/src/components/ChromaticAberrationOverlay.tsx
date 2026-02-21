/**
 * Chromatic Aberration overlay: small chart showing focus shift vs wavelength.
 * Plots data from /api/analysis/chromatic-shift with visible-spectrum Y axis.
 */

import { useEffect, useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, X } from 'lucide-react'
import type { SystemState, Surface } from '../types/system'
import { fetchChromaticShift, type ChromaticShiftPoint } from '../api/chromatic'
import { fetchOptimizeColors } from '../api/optimizeColors'

const CHART_WIDTH = 220
const CHART_HEIGHT = 150
const PAD = { left: 36, right: 12, top: 8, bottom: 24 }
const PLOT_W = CHART_WIDTH - PAD.left - PAD.right
const PLOT_H = CHART_HEIGHT - PAD.top - PAD.bottom

/** Visible spectrum gradient stops (nm -> color) */
const SPECTRUM_STOPS = [
  [400, '#8B5CF6'],   // violet
  [450, '#3B82F6'],   // blue
  [500, '#22C55E'],   // green
  [550, '#84CC16'],   // yellow-green
  [600, '#EAB308'],   // yellow
  [650, '#F97316'],   // orange
  [700, '#EF4444'],   // red
  [800, '#DC2626'],   // deep red
  [1100, '#991B1B'],  // IR
] as [number, string][]

function wavelengthToColor(nm: number): string {
  if (nm <= SPECTRUM_STOPS[0][0]) return SPECTRUM_STOPS[0][1]
  if (nm >= SPECTRUM_STOPS[SPECTRUM_STOPS.length - 1][0]) return SPECTRUM_STOPS[SPECTRUM_STOPS.length - 1][1]
  for (let i = 0; i < SPECTRUM_STOPS.length - 1; i++) {
    const [w0, c0] = SPECTRUM_STOPS[i]
    const [w1] = SPECTRUM_STOPS[i + 1]
    if (nm >= w0 && nm <= w1) return c0
  }
  return '#94A3B8'
}

type ChromaticAberrationOverlayProps = {
  systemState: SystemState
  onSystemStateChange: (state: SystemState | ((prev: SystemState) => SystemState)) => void
  pulseOptimizeTrigger?: number
}

export function ChromaticAberrationOverlay({ systemState, onSystemStateChange, pulseOptimizeTrigger = 0 }: ChromaticAberrationOverlayProps) {
  const [data, setData] = useState<ChromaticShiftPoint[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [optimizeLoading, setOptimizeLoading] = useState(false)
  const [optimizeResult, setOptimizeResult] = useState<{ recommended_glass: string; estimated_lca_reduction: number } | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchData = useCallback(() => {
    setLoading(true)
    setError(null)
    fetchChromaticShift(
      {
        surfaces: systemState.surfaces,
        entrancePupilDiameter: systemState.entrancePupilDiameter ?? 10,
        wavelengths: systemState.wavelengths ?? [587.6],
        fieldAngles: systemState.fieldAngles ?? [0],
        numRays: systemState.numRays ?? 9,
        focusMode: systemState.focusMode ?? 'On-Axis',
        m2Factor: systemState.m2Factor ?? 1.0,
      },
      { wavelengthMinNm: 400, wavelengthMaxNm: 1100, wavelengthStepNm: 10 }
    )
      .then((res) => setData(res))
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to fetch')
        setData([])
      })
      .finally(() => setLoading(false))
  }, [
    systemState.surfaces,
    systemState.entrancePupilDiameter,
    systemState.wavelengths,
    systemState.fieldAngles,
    systemState.numRays,
    systemState.focusMode,
    systemState.m2Factor,
  ])

  const prevSurfacesRef = useRef(systemState.surfaces)
  useEffect(() => {
    const surfacesChanged =
      prevSurfacesRef.current.length !== systemState.surfaces.length ||
      prevSurfacesRef.current.some((s, i) => systemState.surfaces[i]?.material !== s.material)
    prevSurfacesRef.current = systemState.surfaces
    if (surfacesChanged) {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = null
      fetchData()
    } else {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(fetchData, 300)
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [fetchData, systemState.surfaces])

  const designWvl = systemState.wavelengths?.[0] ?? 587.6
  const designPoint = data.find((p) => Math.abs(p.wavelength - designWvl) < 15)
  const designBFL = designPoint?.focus_shift ?? (data.length ? data[Math.floor(data.length / 2)].focus_shift : 0)

  const validData = data.filter((p) => Number.isFinite(p.focus_shift))
  const shiftMin = Math.min(...validData.map((p) => p.focus_shift - designBFL), 0)
  const shiftMax = Math.max(...validData.map((p) => p.focus_shift - designBFL), 0)
  const shiftRange = Math.max(shiftMax - shiftMin, 0.5)
  const shiftLo = shiftMin - shiftRange * 0.1
  const shiftHi = shiftMax + shiftRange * 0.1
  const wvlMin = 400
  const wvlMax = 1100

  const toX = (focusShift: number) => PAD.left + (PLOT_W * (focusShift - shiftLo)) / (shiftHi - shiftLo)
  const toY = (wvl: number) => PAD.top + PLOT_H - (PLOT_H * (wvl - wvlMin)) / (wvlMax - wvlMin)

  const polylinePoints = validData
    .map((p) => `${toX(p.focus_shift - designBFL)},${toY(p.wavelength)}`)
    .join(' ')
  const zeroX = toX(0)

  const [tooltip, setTooltip] = useState<{ wavelength: number; shiftMm: number; x: number; y: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const fromX = (px: number) => shiftLo + ((px - PAD.left) / PLOT_W) * (shiftHi - shiftLo)
  const fromY = (py: number) => wvlMin + ((PAD.top + PLOT_H - py) / PLOT_H) * (wvlMax - wvlMin)

  const handleChartMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!svgRef.current || validData.length < 2) return
      const rect = svgRef.current.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const wvl = fromY(y)
      const shiftMm = fromX(x)
      const nearest = validData.reduce((best, p) => {
        const dist = Math.abs(p.wavelength - wvl) + Math.abs((p.focus_shift - designBFL) - shiftMm) * 0.1
        return dist < best.dist ? { p, dist } : best
      }, { p: validData[0], dist: Infinity })
      setTooltip({
        wavelength: nearest.p.wavelength,
        shiftMm: nearest.p.focus_shift - designBFL,
        x: e.clientX,
        y: e.clientY,
      })
    },
    [validData, designBFL, fromX, fromY]
  )

  const handleChartMouseLeave = useCallback(() => setTooltip(null), [])

  const currentLca =
    validData.length >= 2
      ? (() => {
          const b486 = validData.find((p) => Math.abs(p.wavelength - 486) < 20)
          const b656 = validData.find((p) => Math.abs(p.wavelength - 656) < 20)
          if (!b486 || !b656) return null
          return Math.abs(b486.focus_shift - b656.focus_shift)
        })()
      : null

  const reductionPct =
    optimizeResult && currentLca != null && currentLca > 0
      ? Math.round((optimizeResult.estimated_lca_reduction / currentLca) * 100)
      : null

  const handleOptimize = useCallback(() => {
    setOptimizeLoading(true)
    setOptimizeResult(null)
    fetchOptimizeColors({
      surfaces: systemState.surfaces,
      entrancePupilDiameter: systemState.entrancePupilDiameter ?? 10,
      wavelengths: systemState.wavelengths ?? [587.6],
      fieldAngles: systemState.fieldAngles ?? [0],
      numRays: systemState.numRays ?? 9,
      focusMode: systemState.focusMode ?? 'On-Axis',
      m2Factor: systemState.m2Factor ?? 1.0,
    })
      .then((res) => setOptimizeResult(res))
      .catch(() => setOptimizeResult({ recommended_glass: '', estimated_lca_reduction: 0 }))
      .finally(() => setOptimizeLoading(false))
  }, [systemState])

  const handleApply = useCallback(() => {
    if (!optimizeResult?.recommended_glass || systemState.surfaces.length !== 2) return
    const s0 = systemState.surfaces[0]
    const s1 = systemState.surfaces[1]
    if (s0.type !== 'Glass' || s1.type !== 'Air') return
    const newSurface: Surface = {
      id: crypto.randomUUID(),
      type: 'Glass',
      radius: s1.radius,
      thickness: s0.thickness / 2,
      refractiveIndex: 1.6,
      diameter: s0.diameter,
      material: optimizeResult.recommended_glass,
      description: optimizeResult.recommended_glass,
      coating: 'Uncoated',
    }
    onSystemStateChange((prev) => {
      const next = prev.surfaces.map((s, i) =>
        i === 1 ? { ...s, radius: -s.radius } : { ...s }
      )
      next.splice(1, 0, newSurface)
      return {
        ...prev,
        surfaces: next,
        traceResult: null,
        traceError: null,
      }
    })
    setOptimizeResult(null)
  }, [optimizeResult, systemState.surfaces, onSystemStateChange])

  return (
    <motion.div
      className="absolute z-[40] flex flex-col gap-2"
      style={{
        bottom: 16,
        left: 16,
        width: 240,
        maxWidth: 240,
        pointerEvents: 'auto',
      }}
      initial={{ opacity: 0, y: 12, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 24 }}
    >
      <div
        className="rounded-lg border border-slate-700 bg-slate-900/80 backdrop-blur-md shadow-2xl px-2 py-2 overflow-hidden"
      >
        <div className="text-[10px] font-medium text-slate-400 mb-1 px-1">Chromatic Aberration</div>
        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center justify-center gap-2 py-8 text-slate-400"
            >
              <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} />
              <span className="text-xs">Calculating…</span>
            </motion.div>
          ) : error ? (
            <motion.div
              key="error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="py-4 px-2 text-xs text-red-400/90"
            >
              {error}
            </motion.div>
          ) : validData.length < 2 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="py-6 text-center text-xs text-slate-500"
            >
              No data
            </motion.div>
          ) : (
            <motion.svg
              key="chart"
              ref={svgRef}
              width={CHART_WIDTH}
              height={CHART_HEIGHT}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="block cursor-crosshair"
              onMouseMove={handleChartMouseMove}
              onMouseLeave={handleChartMouseLeave}
            >
              <defs>
                <linearGradient id="chromatic-spectrum-y" x1="0" y1="1" x2="0" y2="0">
                  {SPECTRUM_STOPS.map(([wvl, color], i) => (
                    <stop key={i} offset={(wvl - 400) / 700} stopColor={color} />
                  ))}
                </linearGradient>
              </defs>
              {/* Y-axis spectrum bar */}
              <rect
                x={4}
                y={PAD.top}
                width={8}
                height={PLOT_H}
                fill="url(#chromatic-spectrum-y)"
                rx={2}
                opacity={0.9}
              />
              {/* Y-axis labels */}
              {[400, 550, 700, 1100].map((wvl) => (
                <text
                  key={wvl}
                  x={PAD.left - 8}
                  y={toY(wvl) + 3}
                  textAnchor="end"
                  className="fill-slate-500 text-[9px] font-mono"
                >
                  {wvl}
                </text>
              ))}
              {/* X-axis labels */}
              <text
                x={PAD.left + PLOT_W / 2}
                y={CHART_HEIGHT - 4}
                textAnchor="middle"
                className="fill-slate-500 text-[9px] font-mono"
              >
                Δ focus (mm)
              </text>
              {/* Design focus line (x=0) */}
              <line
                x1={zeroX}
                y1={PAD.top}
                x2={zeroX}
                y2={PAD.top + PLOT_H}
                stroke="rgba(34, 211, 238, 0.8)"
                strokeWidth="1.5"
                strokeDasharray="4 3"
              />
              {/* Polyline */}
              <polyline
                points={polylinePoints}
                fill="none"
                stroke="#22D3EE"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Points with wavelength-colored dots */}
              {validData.map((p, i) => (
                <circle
                  key={i}
                  cx={toX(p.focus_shift - designBFL)}
                  cy={toY(p.wavelength)}
                  r={2}
                  fill={wavelengthToColor(p.wavelength)}
                  stroke="rgba(255,255,255,0.6)"
                  strokeWidth="0.5"
                />
              ))}
            </motion.svg>
          )}
        </AnimatePresence>
        {tooltip && (
          <div
            className="fixed z-[50] px-2 py-1.5 rounded text-xs font-mono bg-slate-900/80 backdrop-blur-md border border-slate-700 text-slate-200 pointer-events-none"
            style={{
              left: tooltip.x + 12,
              top: tooltip.y + 8,
            }}
          >
            {tooltip.wavelength} nm → {(tooltip.shiftMm * 1000).toFixed(2)} µm
          </div>
        )}
      </div>

      <motion.button
        type="button"
        onClick={handleOptimize}
        disabled={optimizeLoading || systemState.surfaces.length !== 2}
        className="w-full py-2 px-3 rounded-lg text-sm font-medium text-white bg-gradient-to-r from-cyan-500 to-indigo-500 hover:from-cyan-400 hover:to-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg"
        animate={
          pulseOptimizeTrigger > 0
            ? {
                scale: [1, 1.05, 1],
                boxShadow: [
                  '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                  '0 0 24px 4px rgba(34, 211, 238, 0.6)',
                  '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                ],
              }
            : undefined
        }
        transition={
          pulseOptimizeTrigger > 0
            ? { duration: 1.2, repeat: 2, ease: 'easeInOut' }
            : undefined
        }
      >
        {optimizeLoading ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} />
            Optimizing…
          </span>
        ) : (
          'Optimize Colors'
        )}
      </motion.button>

      <AnimatePresence>
        {optimizeResult?.recommended_glass && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="rounded-lg border border-slate-700 bg-slate-900/80 backdrop-blur-md shadow-2xl p-3"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <p className="text-xs text-slate-300">
                Pair with <span className="font-semibold text-cyan-400">{optimizeResult.recommended_glass}</span>
                {reductionPct != null ? ` to reduce shift by ${reductionPct}%` : ` (${optimizeResult.estimated_lca_reduction.toFixed(2)} mm)`}
              </p>
              <button
                type="button"
                onClick={() => setOptimizeResult(null)}
                className="p-0.5 rounded text-slate-500 hover:text-slate-300"
                aria-label="Close"
              >
                <X className="w-3.5 h-3.5" strokeWidth={2} />
              </button>
            </div>
            <button
              type="button"
              onClick={handleApply}
              className="w-full py-1.5 px-3 rounded text-xs font-medium bg-gradient-to-r from-cyan-500 to-indigo-500 text-white hover:from-cyan-400 hover:to-indigo-400 transition-all"
            >
              Apply
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
