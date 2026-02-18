import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Play } from 'lucide-react'
import type { SystemState } from '../types/system'

// Field angle colors: cyan (on-axis), orange (mid), green (edge)
const RAY_COLORS = ['#22D3EE', '#F97316', '#22C55E'] as const

type RayPoint = { x: number; y: number }
type Ray = { points: RayPoint[]; color: string }

// Simple lens geometry: two arcs for a singlet
function getLensPath(
  x1: number,
  x2: number,
  radius1: number,
  radius2: number,
  semiHeight: number,
  viewHeight: number,
  scale: number,
  xOffset: number
): string {
  const cy = viewHeight / 2
  const toView = (x: number, y: number) => `${x * scale + xOffset},${-y * scale + cy}`

  const n = 24
  const pts: string[] = []

  // Front surface (convex)
  if (Math.abs(radius1) > 0.1) {
    const r1 = radius1
    for (let i = 0; i <= n; i++) {
      const theta = (i / n) * Math.PI - Math.PI / 2
      const y = Math.sin(theta) * semiHeight
      const z = r1 - Math.sqrt(Math.max(0, r1 * r1 - y * y))
      pts.push(toView(x1 + z, y))
    }
  } else {
    pts.push(toView(x1, semiHeight))
    pts.push(toView(x1, -semiHeight))
  }

  // Back surface (concave)
  if (Math.abs(radius2) > 0.1) {
    const r2 = -radius2
    for (let i = n; i >= 0; i--) {
      const theta = (i / n) * Math.PI - Math.PI / 2
      const y = Math.sin(theta) * semiHeight
      const z = r2 - Math.sqrt(Math.max(0, r2 * r2 - y * y))
      pts.push(toView(x2 - z, y))
    }
  } else {
    pts.push(toView(x2, -semiHeight))
    pts.push(toView(x2, semiHeight))
  }

  return `M ${pts.join(' L ')} Z`
}

// Generate rays for a simple singlet (parallel input, focus)
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
    // Field angle colors: on-axis=cyan, mid=orange, edge=green
    const distFromCenter = Math.abs(t - 0.5)
    const color =
      distFromCenter < 0.15
        ? RAY_COLORS[0]
        : distFromCenter < 0.4
          ? RAY_COLORS[1]
          : RAY_COLORS[2]

    // Paraxial focus: y_focus ≈ y * (1 - EFL/focus_dist)
    const focusY = y * 0.15

    const points: RayPoint[] = [
      { x: 0, y },
      { x: lensX1, y },
      { x: lensX2, y: y + (focusY - y) * 0.3 },
      { x: focusX, y: focusY },
    ]

    rays.push({ points, color })
  }

  return rays
}

type OpticalViewportProps = {
  className?: string
  systemState: SystemState
  onSystemStateChange: (state: SystemState | ((prev: SystemState) => SystemState)) => void
}

export function OpticalViewport({
  className = '',
  systemState,
  onSystemStateChange,
}: OpticalViewportProps) {
  const numRays = systemState.numRays
  const hasTraced = systemState.hasTraced
  const setNumRays = (n: number) =>
    onSystemStateChange((prev) => ({ ...prev, numRays: n }))
  const setHasTraced = () =>
    onSystemStateChange((prev) => ({ ...prev, hasTraced: true }))

  const viewWidth = 640
  const viewHeight = 320
  const scale = 1.8
  const xOffset = 60

  const s0 = systemState.surfaces[0]
  const s1 = systemState.surfaces[1]
  const lensX1 = 40
  const lensX2 = lensX1 + (s0?.thickness ?? 5)
  const focusX = lensX2 + (s1?.thickness ?? 95) * 0.7
  const semiHeight = (systemState.entrancePupilDiameter ?? 10) / 2

  const radius1 = s0?.radius ?? 100
  const radius2 = s1?.radius ?? -100

  const lensPath = useMemo(
    () =>
      getLensPath(
        lensX1,
        lensX2,
        radius1,
        radius2,
        semiHeight,
        viewHeight,
        scale,
        xOffset
      ),
    [lensX1, lensX2, radius1, radius2, semiHeight, viewHeight, scale, xOffset]
  )

  const rays = useMemo(
    () =>
      hasTraced
        ? generateRays(numRays, lensX1, lensX2, focusX, semiHeight)
        : [],
    [hasTraced, numRays, lensX1, lensX2, focusX, semiHeight]
  )

  const toSvg = (x: number, y: number) =>
    `${x * scale + xOffset},${-y * scale + viewHeight / 2}`

  return (
    <div className={`relative ${className}`}>
      {/* Controls */}
      <div className="absolute top-4 left-4 z-10 flex items-center gap-4 glass-card px-4 py-2 rounded-lg">
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.98 }}
          onClick={setHasTraced}
          className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all"
          style={{
            background: 'linear-gradient(135deg, #22D3EE 0%, #0891b2 100%)',
            color: '#0B1120',
            boxShadow: '0 0 24px rgba(34, 211, 238, 0.5)',
          }}
        >
          <Play className="w-5 h-5" fill="currentColor" strokeWidth={0} />
          Trace
        </motion.button>
        <div className="flex items-center gap-3">
          <span className="text-slate-400 text-sm whitespace-nowrap">Rays</span>
          <input
            type="range"
            min={3}
            max={21}
            value={numRays}
            onChange={(e) => setNumRays(Number(e.target.value))}
            className="w-28 h-2 rounded-full accent-cyan-electric bg-white/10 cursor-pointer"
          />
          <span className="text-cyan-electric text-sm font-mono w-6">{numRays}</span>
        </div>
      </div>

      {/* SVG Canvas */}
      <div
        className="overflow-hidden rounded-xl"
        style={{
          backgroundColor: '#0B1120',
          border: '1px solid rgba(34, 211, 238, 0.2)',
        }}
      >
        <svg
          viewBox={`0 0 ${viewWidth} ${viewHeight}`}
          className="w-full h-full min-h-[320px]"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            {/* Glow filter for lens */}
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
            {/* Linear gradient for lens fill */}
            <linearGradient id="lens-fill" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#22D3EE" stopOpacity="0.15" />
              <stop offset="50%" stopColor="#22D3EE" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#22D3EE" stopOpacity="0.15" />
            </linearGradient>
          </defs>

          {/* Grid */}
          <g opacity="0.12">
            {Array.from({ length: Math.ceil(viewWidth / 64) + 1 }, (_, i) => (
              <line
                key={`v${i}`}
                x1={i * 64}
                y1={0}
                x2={i * 64}
                y2={viewHeight}
                stroke="#22D3EE"
                strokeWidth="0.5"
              />
            ))}
            {Array.from({ length: Math.ceil(viewHeight / 64) + 1 }, (_, i) => (
              <line
                key={`h${i}`}
                x1={0}
                y1={i * 64}
                x2={viewWidth}
                y2={i * 64}
                stroke="#22D3EE"
                strokeWidth="0.5"
              />
            ))}
          </g>

          {/* Lens */}
          <g filter="url(#lens-glow)">
            <path
              d={lensPath}
              fill="url(#lens-fill)"
              stroke="#22D3EE"
              strokeWidth="1.5"
              strokeOpacity="0.8"
              style={{ filter: 'drop-shadow(0 0 6px rgba(34, 211, 238, 0.4))' }}
            />
          </g>

          {/* Rays */}
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
                style={{
                  filter: `drop-shadow(0 0 2px ${ray.color})`,
                }}
              />
            )
          })}

          {/* Focal point */}
          {hasTraced && rays.length > 0 && (
            <motion.circle
              cx={focusX * scale + xOffset}
              cy={viewHeight / 2}
              r="4"
              fill="#22D3EE"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.5 }}
              filter="url(#glow-strong)"
            />
          )}
        </svg>
      </div>
    </div>
  )
}
