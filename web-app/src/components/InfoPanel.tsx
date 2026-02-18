import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Info, MoveHorizontal, Activity, Maximize2, Focus, Lightbulb, Copy, Check } from 'lucide-react'
import type { HighlightedMetric } from '../types/ui'

type GlossaryCardProps = {
  title: string
  explanation: string
  formula: string
  diagram: React.ReactNode
  icon: React.ReactNode
  isHighlighted: boolean
  onMouseEnter: () => void
  onMouseLeave: () => void
}

function GlossaryCard({
  title,
  explanation,
  formula,
  diagram,
  icon,
  isHighlighted,
  onMouseEnter,
  onMouseLeave,
}: GlossaryCardProps) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(formula)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }, [formula])

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`glass-card p-5 rounded-xl border overflow-hidden transition-all duration-200 ${
        isHighlighted ? 'border-cyan-electric/60 ring-1 ring-cyan-electric/30' : 'border-white/10'
      }`}
    >
      <div className="flex gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-cyan-electric">{icon}</span>
            <h3 className="font-bold text-cyan-electric text-base">{title}</h3>
          </div>
          <p className="text-slate-300 text-sm leading-relaxed mb-3">{explanation}</p>
          <div className="flex items-center gap-2">
            <div
              className="flex-1 min-w-0 font-mono text-xs text-slate-400 bg-black/20 rounded-lg px-3 py-2 border border-white/5"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              {formula}
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                handleCopy()
              }}
              className="shrink-0 p-2 rounded-lg text-slate-400 hover:text-cyan-electric hover:bg-white/5 transition-colors"
              title="Copy to clipboard"
              aria-label="Copy formula to clipboard"
            >
              {copied ? (
                <Check className="w-4 h-4 text-green-400" strokeWidth={2} />
              ) : (
                <Copy className="w-4 h-4" strokeWidth={2} />
              )}
            </button>
          </div>
        </div>
        <div className="shrink-0 w-20 h-20 flex items-center justify-center text-slate-500">
          {diagram}
        </div>
      </div>
    </motion.div>
  )
}

const GLOSSARY_ITEMS: (Omit<GlossaryCardProps, 'diagram' | 'icon' | 'isHighlighted' | 'onMouseEnter' | 'onMouseLeave'> & { metricId: Exclude<HighlightedMetric, null> })[] = [
  {
    title: 'Z-Position',
    metricId: 'z',
    explanation: 'The axial distance from the global coordinate origin (Z=0).',
    formula: 'z ∈ ℝ  (mm, along optical axis)',
  },
  {
    title: 'RMS Radius',
    metricId: 'rms',
    explanation:
      "The 'Root Mean Square' of ray distances from the centroid. This represents the effective 'blur' size.",
    formula: 'R_rms = √((1/n) Σ (y_i − ȳ)²)',
  },
  {
    title: 'Beam Width',
    metricId: 'beamWidth',
    explanation: 'The total vertical spread (Full Aperture) of the ray bundle at the current Z-plane.',
    formula: 'W = max(yᵢ) − min(yᵢ)',
  },
  {
    title: 'Chief Ray Angle (CRA)',
    metricId: 'cra',
    explanation:
      'The angle (in degrees) of the ray passing through the center of the aperture stop relative to the optical axis.',
    formula: 'CRA = arctan(dy/dz)  [°]',
  },
]

const GLOSSARY_ICONS = [
  <MoveHorizontal key="z" className="w-5 h-5" strokeWidth={2} />,
  <Activity key="rms" className="w-5 h-5" strokeWidth={2} />,
  <Maximize2 key="beam" className="w-5 h-5" strokeWidth={2} />,
  <Focus key="cra" className="w-5 h-5" strokeWidth={2} />,
]

function ZPosDiagram() {
  return (
    <svg viewBox="0 0 80 80" className="w-full h-full">
      <line x1="8" y1="40" x2="72" y2="40" stroke="#22D3EE" strokeWidth="1.5" strokeOpacity="0.6" />
      <line x1="40" y1="35" x2="40" y2="45" stroke="#22D3EE" strokeWidth="2" />
      <text x="40" y="58" fill="#94a3b8" fontSize="10" textAnchor="middle">Z</text>
      <text x="72" y="35" fill="#64748b" fontSize="8" textAnchor="middle">→</text>
    </svg>
  )
}

function RMSDiagram() {
  return (
    <svg viewBox="0 0 80 80" className="w-full h-full">
      <circle cx="40" cy="40" r="2" fill="#22D3EE" opacity="0.9" />
      <circle cx="35" cy="38" r="1.5" fill="#22D3EE" opacity="0.7" />
      <circle cx="45" cy="42" r="1.5" fill="#22D3EE" opacity="0.7" />
      <circle cx="38" cy="44" r="1.5" fill="#22D3EE" opacity="0.7" />
      <circle cx="42" cy="36" r="1.5" fill="#22D3EE" opacity="0.7" />
      <circle cx="40" cy="40" r="12" fill="none" stroke="#22D3EE" strokeWidth="1" strokeDasharray="3 2" opacity="0.5" />
    </svg>
  )
}

function BeamWidthDiagram() {
  return (
    <svg viewBox="0 0 80 80" className="w-full h-full">
      <path d="M 15 25 L 65 35" stroke="#22D3EE" strokeWidth="2" fill="none" opacity="0.8" />
      <path d="M 15 55 L 65 45" stroke="#22D3EE" strokeWidth="2" fill="none" opacity="0.8" />
      <line x1="40" y1="35" x2="40" y2="45" stroke="#f97316" strokeWidth="1.5" strokeDasharray="2 2" />
      <line x1="38" y1="35" x2="42" y2="35" stroke="#f97316" strokeWidth="1" />
      <line x1="38" y1="45" x2="42" y2="45" stroke="#f97316" strokeWidth="1" />
    </svg>
  )
}

function CRADiagram() {
  return (
    <svg viewBox="0 0 80 80" className="w-full h-full">
      <line x1="15" y1="40" x2="65" y2="40" stroke="#64748b" strokeWidth="1" strokeOpacity="0.5" />
      <line x1="25" y1="55" x2="65" y2="25" stroke="#22D3EE" strokeWidth="2" strokeOpacity="0.9" />
      <path d="M 55 35 A 12 12 0 0 1 65 25" fill="none" stroke="#f97316" strokeWidth="1" strokeDasharray="2 2" />
      <text x="52" y="28" fill="#94a3b8" fontSize="8">θ</text>
    </svg>
  )
}

const DIAGRAMS = [ZPosDiagram, RMSDiagram, BeamWidthDiagram, CRADiagram]

const PHYSICS_TIPS = [
  'Minimizing RMS at the image plane reduces blur and improves sharpness.',
  'Use the scan line to find where beam width is smallest—that’s your best focus region.',
  'Keep CRA within your sensor’s spec; high angles can cause vignetting and color shift.',
  'Adjust thicknesses and radii iteratively while watching RMS and beam width at focus.',
]

type InfoPanelProps = {
  highlightedMetric: HighlightedMetric
  onHighlightMetric: (m: HighlightedMetric) => void
}

export function InfoPanel({ highlightedMetric, onHighlightMetric }: InfoPanelProps) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 space-y-6">
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-xl border border-white/10 p-6 backdrop-blur-xl"
        >
          <div className="flex items-center gap-2 mb-2">
            <Info className="w-6 h-6 text-cyan-electric" strokeWidth={2} />
            <h2 className="text-xl font-bold text-cyan-electric">Info</h2>
          </div>
          <p className="text-slate-400 text-sm">
            Reference and definitions for the metrics used in the scanning HUD and optical analysis.
          </p>
        </motion.div>

        <section>
          <h2 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5 text-cyan-electric/80" strokeWidth={2} />
            Glossary
          </h2>
          <p className="text-slate-500 text-xs mb-3">
            Hover a card to highlight its value in the viewport HUD.
          </p>
          <div className="space-y-4">
            {GLOSSARY_ITEMS.map((item, i) => {
              const Diagram = DIAGRAMS[i]
              return (
                <GlossaryCard
                  key={item.title}
                  {...item}
                  diagram={Diagram ? <Diagram /> : null}
                  icon={GLOSSARY_ICONS[i]}
                  isHighlighted={highlightedMetric === item.metricId}
                  onMouseEnter={() => onHighlightMetric(item.metricId)}
                  onMouseLeave={() => onHighlightMetric(null)}
                />
              )
            })}
          </div>
        </section>

        <section className="glass-card rounded-xl border border-white/10 p-5">
          <h2 className="text-lg font-semibold text-slate-200 mb-3 flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-cyan-electric/80" strokeWidth={2} />
            Physics Tips
          </h2>
          <p className="text-slate-400 text-sm mb-4">
            How to use these metrics to improve your lens design:
          </p>
          <ul className="space-y-2">
            {PHYSICS_TIPS.map((tip, i) => (
              <li key={i} className="flex gap-2 text-sm text-slate-300">
                <span className="text-cyan-electric shrink-0">•</span>
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
