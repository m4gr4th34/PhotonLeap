import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MousePointer2,
  Zap,
  FileText,
  ScanLine,
  ChevronDown,
} from 'lucide-react'
import { isMac } from '../config'
import type { HighlightedMetric } from '../types/ui'

const kbdClass =
  'px-1.5 py-0.5 rounded bg-slate-800/90 text-slate-200 font-mono text-[10px] shadow-[0_1px_0_0_rgba(255,255,255,0.1),inset_0_-1px_0_0_rgba(0,0,0,0.3)]'

const SECTIONS = [
  {
    id: 'nav',
    title: 'Navigation Shortcuts',
    icon: MousePointer2,
  },
  {
    id: 'laser',
    title: 'Laser & Gaussian Optics',
    icon: ScanLine,
  },
  {
    id: 'ultrafast',
    title: 'Ultrafast / Femtosecond Design',
    icon: Zap,
  },
  {
    id: 'export',
    title: 'Manufacturing Export',
    icon: FileText,
  },
] as const

type SectionId = (typeof SECTIONS)[number]['id']

function AccordionItem({
  id,
  title,
  icon: Icon,
  isOpen,
  onToggle,
  children,
}: {
  id: SectionId
  title: string
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  isOpen: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="border-b border-white/10 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-white/5 transition-colors rounded-lg"
        aria-expanded={isOpen}
        aria-controls={`accordion-content-${id}`}
        id={`accordion-header-${id}`}
      >
        <div className="flex items-center gap-2.5">
          <Icon className="w-5 h-5 text-cyan-electric shrink-0" strokeWidth={2} />
          <span className="font-semibold text-slate-200">{title}</span>
        </div>
        <motion.span
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="text-slate-400 shrink-0"
        >
          <ChevronDown className="w-5 h-5" strokeWidth={2} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            id={`accordion-content-${id}`}
            key={id}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
            className="overflow-hidden"
            role="region"
            aria-labelledby={`accordion-header-${id}`}
          >
            <div className="px-4 pb-4 pt-0 text-slate-400 text-sm leading-relaxed">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

type GlossaryCardProps = {
  title: string
  explanation: string
  formula: string
  isHighlighted: boolean
  onMouseEnter: () => void
  onMouseLeave: () => void
}

function GlossaryCard({
  title,
  explanation,
  formula,
  isHighlighted,
  onMouseEnter,
  onMouseLeave,
}: GlossaryCardProps) {
  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`p-3 rounded-lg border transition-all duration-200 ${
        isHighlighted ? 'border-cyan-electric/60 bg-cyan-electric/5' : 'border-white/10 bg-white/5'
      }`}
    >
      <h4 className="font-medium text-cyan-electric text-sm mb-1">{title}</h4>
      <p className="text-slate-400 text-xs leading-relaxed mb-2">{explanation}</p>
      <code className="block font-mono text-xs text-slate-500 bg-black/20 rounded px-2 py-1 w-fit">
        {formula}
      </code>
    </div>
  )
}

const GLOSSARY_ITEMS: {
  title: string
  explanation: string
  formula: string
  metricId: Exclude<HighlightedMetric, null>
}[] = [
  {
    title: 'Z-Position',
    metricId: 'z',
    explanation: 'Axial distance from the global coordinate origin along the optical axis.',
    formula: 'z ∈ ℝ  (mm)',
  },
  {
    title: 'RMS Radius',
    metricId: 'rms',
    explanation: "Root mean square of ray distances from the centroid—effective 'blur' size.",
    formula: 'R_rms = √((1/n) Σ (y_i − ȳ)²)',
  },
  {
    title: 'Beam Width',
    metricId: 'beamWidth',
    explanation: 'Full aperture: total vertical spread of the ray bundle at the current Z-plane.',
    formula: 'W = max(yᵢ) − min(yᵢ)',
  },
  {
    title: 'Chief Ray Angle (CRA)',
    metricId: 'cra',
    explanation: 'Angle of the ray through the aperture stop center relative to the optical axis.',
    formula: 'CRA = arctan(dy/dz)  [°]',
  },
]

type InfoPanelProps = {
  highlightedMetric: HighlightedMetric
  onHighlightMetric: (m: HighlightedMetric) => void
}

export function InfoPanel({ highlightedMetric, onHighlightMetric }: InfoPanelProps) {
  const [openSection, setOpenSection] = useState<SectionId | null>('nav')

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 pb-8">
        <div className="bg-slate-900/40 backdrop-blur-md rounded-xl border border-white/10 overflow-hidden shadow-xl">
          <div className="px-4 py-4 border-b border-white/10">
            <h2 className="text-lg font-bold text-cyan-electric">User Guide</h2>
            <p className="text-slate-400 text-xs mt-0.5">
              Documentation for optical design workflows
            </p>
          </div>
          <div className="p-2">
            {SECTIONS.map(({ id, title, icon }) => (
              <AccordionItem
                key={id}
                id={id}
                title={title}
                icon={icon}
                isOpen={openSection === id}
                onToggle={() => setOpenSection((s) => (s === id ? null : id))}
              >
                {id === 'nav' && (
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-slate-300 font-medium text-xs uppercase tracking-wider mb-2">
                        Keyboard shortcuts
                      </h4>
                      <ul className="space-y-2 text-slate-400">
                        <li className="flex items-center gap-2">
                          <kbd className={kbdClass}>Space</kbd>
                          <span>+</span>
                          <kbd className={kbdClass}>Drag</kbd>
                          <span className="text-slate-500">— Pan viewport</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <kbd className={kbdClass}>Scroll</kbd>
                          <span className="text-slate-500">— Zoom in/out</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <kbd className={kbdClass}>Double Click</kbd>
                          <span className="text-slate-500">— Reset view</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <kbd className={kbdClass}>{isMac ? '⌥ Option' : 'Alt'}</kbd>
                          <span className="text-slate-500">— Override Snap-to-Focus</span>
                        </li>
                      </ul>
                    </div>
                    <div>
                      <h4 className="text-slate-300 font-medium text-xs uppercase tracking-wider mb-2">
                        Scan line
                      </h4>
                      <p>
                        Drag the scan line in the viewport to sweep Z and inspect RMS, beam width,
                        and CRA. Use Snap to Focus / Snap to Surface to jump to key positions.
                      </p>
                    </div>
                    <div>
                      <h4 className="text-slate-300 font-medium text-xs uppercase tracking-wider mb-2">
                        HUD &amp; metrics
                      </h4>
                      <p>
                        Hover glossary cards in this guide to highlight the corresponding metric in
                        the viewport HUD.
                      </p>
                    </div>
                  </div>
                )}
                {id === 'laser' && (
                  <div className="space-y-4">
                    <p>
                      Laser systems typically use Gaussian or near-Gaussian beam profiles. The
                      scan metrics help you locate the beam waist, minimize spot size, and control
                      divergence.
                    </p>
                    <p>
                      The HUD now displays Beam Waist (w₀) and Rayleigh Range (z<sub>R</sub>). For
                      laser design, ensure your M² factor is set in System Properties to simulate
                      real-world beam quality.
                    </p>
                    <div className="space-y-2">
                      {GLOSSARY_ITEMS.map((item) => (
                        <GlossaryCard
                          key={item.title}
                          {...item}
                          isHighlighted={highlightedMetric === item.metricId}
                          onMouseEnter={() => onHighlightMetric(item.metricId)}
                          onMouseLeave={() => onHighlightMetric(null)}
                        />
                      ))}
                    </div>
                    <p>
                      <strong className="text-slate-300">Tip:</strong> Minimize RMS at the image
                      plane to reduce blur; use the scan line to find where beam width is smallest.
                    </p>
                    <div className="rounded-lg border border-cyan-electric/50 bg-cyan-electric/5 px-3 py-2.5">
                      <p className="text-xs font-medium text-cyan-electric/90 mb-0.5">Pro-Tip</p>
                      <p className="text-slate-400 text-sm leading-relaxed">
                        Note: The Gold Diamond indicates the point of minimum beam waist, which may
                        shift based on lens dispersion.
                      </p>
                    </div>
                  </div>
                )}
                {id === 'ultrafast' && (
                  <div className="space-y-4">
                    <p>
                      Ultrafast and femtosecond optics introduce dispersion, group delay, and
                      pulse broadening. This app models chromatic dispersion and thermal lensing
                      to support pulsed-laser system design.
                    </p>
                    <ul className="space-y-1.5">
                      <li>
                        • <strong className="text-slate-300">Dispersion</strong> — wavelength-dependent
                        refractive index (Abbe V) affects pulse temporal shape
                      </li>
                      <li>
                        • <strong className="text-slate-300">Thermal lensing</strong> — absorption + dn/dT
                        cause focal shift at high power (use Heat Map in System Properties)
                      </li>
                      <li>
                        • <strong className="text-slate-300">Ultrafast HUD</strong> — view GDD and
                        pulse metrics when the scan line is active
                      </li>
                    </ul>
                  </div>
                )}
                {id === 'export' && (
                  <div className="space-y-4">
                    <p>
                      Export your optical system as an ISO 10110–style technical drawing for
                      manufacturing and documentation.
                    </p>
                    <ul className="space-y-1.5">
                      <li>
                        • <strong className="text-slate-300">Export tab</strong> — cross-section,
                        dimensions (CT), data table (Surf, S/D, Material, CT), and title block
                      </li>
                      <li>
                        • <strong className="text-slate-300">S/D (Scratch/Dig)</strong> — surface
                        quality per ISO 10110; editable in System Editor
                      </li>
                      <li>
                        • <strong className="text-slate-300">SVG / PDF</strong> — high-resolution
                        export via Export Drawing and browser print
                      </li>
                    </ul>
                  </div>
                )}
              </AccordionItem>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
