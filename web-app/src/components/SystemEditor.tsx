import { useRef, useEffect, useLayoutEffect, useState } from 'react'
import ReactDOM from 'react-dom'
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd'
import { motion } from 'framer-motion'
import { ChevronDown, GripVertical, Plus, Trash2, Search } from 'lucide-react'
import type { SystemState, Surface } from '../types/system'
import { config } from '../config'
import { fetchMaterials, type MaterialOption } from '../api/materials'

/** Fallback when API is unavailable */
const GLASS_LIBRARY_FALLBACK: MaterialOption[] = [
  { name: 'Air', n: 1 },
  { name: 'N-BK7', n: 1.5168 },
  { name: 'Fused Silica', n: 1.458 },
  { name: 'N-SF11', n: 1.78472 },
  { name: 'N-SF5', n: 1.6727 },
]

/** Surface shape presets: radius (mm) and thickness (mm) */
const SURFACE_PRESETS: { name: string; radius: number; thickness: number }[] = [
  { name: 'Biconvex', radius: 100, thickness: 6 },
  { name: 'Plano-Convex', radius: 100, thickness: 5 },
  { name: 'Meniscus', radius: 70, thickness: 4 },
]

type SystemEditorProps = {
  systemState: SystemState
  onSystemStateChange: (state: SystemState | ((prev: SystemState) => SystemState)) => void
  onLoadComplete?: (fileName: string) => void
  selectedSurfaceId: string | null
  onSelectSurface: (id: string | null) => void
  /** Per-surface sensitivity from Monte Carlo (higher = more failure impact) */
  sensitivityBySurface?: number[] | null
}

const inputClass =
  'w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-sm text-slate-200 focus:outline-none focus:border-cyan-electric/50 focus:shadow-[0_0_8px_rgba(34,211,238,0.25)] transition-shadow'

const numericInputClass =
  'w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-sm text-slate-200 focus:outline-none focus:border-cyan-electric/50 focus:shadow-[0_0_8px_rgba(34,211,238,0.25)] transition-shadow font-mono tabular-nums'

const COMMON_MATERIALS = ['N-BK7', 'Fused Silica']

function MaterialCombobox({
  value,
  onChange,
  onClick,
  materials,
}: {
  value: string
  onChange: (material: string, n?: number) => void
  onClick?: (e: React.MouseEvent) => void
  materials: MaterialOption[]
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const portalRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 })

  const updatePosition = useRef(() => {
    if (inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect()
      setPosition({
        top: rect.bottom,
        left: rect.left,
        width: rect.width,
      })
    }
  })

  const filtered = query.trim()
    ? materials.filter((m) =>
        m.name.toLowerCase().includes(query.toLowerCase())
      )
    : materials

  const commonFiltered = filtered.filter((m) => COMMON_MATERIALS.includes(m.name))
  const restFiltered = filtered.filter((m) => !COMMON_MATERIALS.includes(m.name))

  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useLayoutEffect(() => {
    if (isOpen && inputRef.current) {
      updatePosition.current()
      inputRef.current.focus()
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const handler = () => updatePosition.current()
    window.addEventListener('scroll', handler, true)
    window.addEventListener('resize', handler)
    return () => {
      window.removeEventListener('scroll', handler, true)
      window.removeEventListener('resize', handler)
    }
  }, [isOpen])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        inputRef.current?.contains(target) ||
        portalRef.current?.contains(target)
      ) {
        return
      }
      if (query.trim() && query !== value) {
        onChangeRef.current(query.trim())
      }
      setQuery('')
      setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [query, value, isOpen])

  const handleSelect = (m: MaterialOption) => {
    onChange(m.name, m.n)
    setQuery('')
    setIsOpen(false)
  }

  const dropdownContent =
    isOpen &&
    ReactDOM.createPortal(
      <motion.div
        ref={portalRef}
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.15 }}
        className="fixed z-[9999] min-w-[12rem] max-h-64 overflow-auto rounded-lg border border-slate-700 bg-slate-900/95 shadow-2xl backdrop-blur-xl"
        style={{
          top: position.top + 4,
          left: position.left,
          width: Math.max(position.width, 192),
        }}
      >
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-700 bg-slate-900/95 px-2 py-1.5">
          <Search className="w-4 h-4 shrink-0 text-slate-400" strokeWidth={2} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search materials..."
            className="flex-1 bg-transparent text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none"
            autoComplete="off"
          />
        </div>
        <div className="py-1">
          {commonFiltered.length > 0 && (
            <div className="px-2 py-1">
              <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500 mb-0.5">
                Common
              </div>
              {commonFiltered.map((m) => (
                <button
                  key={m.name}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleSelect(m)
                  }}
                  className="w-full text-left px-2 py-1.5 text-sm hover:bg-cyan-electric/20 text-slate-200 rounded"
                >
                  {m.name} <span className="text-slate-500">(n={m.n})</span>
                </button>
              ))}
            </div>
          )}
          {restFiltered.length > 0 && (
            <div className="px-2 py-1">
              {commonFiltered.length > 0 && (
                <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500 mb-0.5">
                  All
                </div>
              )}
              {restFiltered.map((m) => (
                <button
                  key={m.name}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleSelect(m)
                  }}
                  className="w-full text-left px-2 py-1.5 text-sm hover:bg-cyan-electric/20 text-slate-200 rounded"
                >
                  {m.name} <span className="text-slate-500">(n={m.n})</span>
                </button>
              ))}
            </div>
          )}
          {filtered.length === 0 && (
            <div className="px-2 py-3 text-sm text-slate-500">No matches</div>
          )}
        </div>
      </motion.div>,
      document.body
    )

  return (
    <div className="flex gap-0.5">
      <div className="relative flex-1">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={isOpen ? query : value}
          onChange={(e) => {
            setQuery(e.target.value)
            if (!isOpen) setIsOpen(true)
          }}
          onFocus={() => {
            setQuery(value)
            setIsOpen(true)
          }}
          onClick={onClick}
          placeholder="Material..."
          className={`${inputClass} pl-8`}
        />
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          if (!isOpen) {
            setQuery(value)
            updatePosition.current()
            setTimeout(() => inputRef.current?.focus(), 0)
          }
          setIsOpen((o) => !o)
        }}
        className="p-1 rounded bg-white/5 border border-white/10 text-slate-400 hover:text-cyan-electric shrink-0"
        aria-label="Toggle material list"
      >
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} strokeWidth={2} />
      </button>
      {dropdownContent}
    </div>
  )
}

/** Indices of surfaces with highest sensitivity (for heatmap highlight) */
function getHighSensitivityIndices(sensitivityBySurface: number[] | null | undefined): Set<number> {
  if (!sensitivityBySurface?.length) return new Set()
  const maxVal = Math.max(...sensitivityBySurface)
  if (maxVal <= 0) return new Set()
  const indices = new Set<number>()
  sensitivityBySurface.forEach((v, i) => {
    if (v >= maxVal * 0.9) indices.add(i)
  })
  return indices
}

export function SystemEditor({
  systemState,
  onSystemStateChange,
  onLoadComplete: _onLoadComplete, // Reserved for load/save design
  selectedSurfaceId,
  onSelectSurface,
  sensitivityBySurface,
}: SystemEditorProps) {
  const surfaces = systemState.surfaces
  const highSensitivityIndices = getHighSensitivityIndices(sensitivityBySurface)
  const [glassMaterials, setGlassMaterials] = useState<MaterialOption[]>(GLASS_LIBRARY_FALLBACK)

  useEffect(() => {
    fetchMaterials().then(setGlassMaterials)
  }, [])

  const addSurfaceAtStart = () => addSurfaceAtIndex(0)

  const addSurfaceAtIndex = (index: number) => {
    const d = config.surfaceDefaults
    const newSurface: Surface = {
      id: crypto.randomUUID(),
      type: 'Air',
      radius: 0,
      thickness: d.thickness,
      refractiveIndex: 1,
      diameter: d.diameter,
      material: 'Air',
      description: 'New surface',
    }
    onSystemStateChange((prev) => {
      const next = [...prev.surfaces]
      next.splice(index, 0, newSurface)
      return {
        ...prev,
        surfaces: next,
        traceResult: null,
        traceError: null,
      }
    })
  }

  const removeSurface = (id: string) => {
    onSystemStateChange((prev) => ({
      ...prev,
      surfaces: prev.surfaces.filter((s) => s.id !== id),
      traceResult: null,
      traceError: null,
    }))
    if (selectedSurfaceId === id) onSelectSurface(null)
  }

  const updateSurface = (id: string, updates: Partial<Surface>) => {
    onSystemStateChange((prev) => ({
      ...prev,
      surfaces: prev.surfaces.map((s) =>
        s.id === id ? { ...s, ...updates } : s
      ),
      traceResult: null,
      traceError: null,
    }))
  }

  const onDragEnd = (result: DropResult) => {
    if (!result.destination || result.source.index === result.destination.index) return
    const from = result.source.index
    const to = result.destination.index
    onSystemStateChange((prev) => {
      const next = [...prev.surfaces]
      const [removed] = next.splice(from, 1)
      next.splice(to, 0, removed)
      return {
        ...prev,
        surfaces: next,
        traceResult: null,
        traceError: null,
        pendingTrace: true,
      }
    })
  }

  return (
    <div className="p-4">
      <h2 className="text-cyan-electric font-semibold text-lg mb-4">System Editor</h2>
      <div className="overflow-x-auto overflow-y-visible rounded-lg">
        <DragDropContext onDragEnd={onDragEnd}>
        <table className="w-full text-sm border-collapse overflow-visible">
          <thead>
            <tr className="text-left text-slate-400 border-b border-white/10 bg-slate-900/40 backdrop-blur-[4px]">
              <th className="w-8 py-2 pr-1" aria-label="Drag handle" />
              <th className="py-2 pr-4">#</th>
              <th className="py-2 pr-4">Type</th>
              <th className="py-2 pr-4">Radius (mm)</th>
              <th className="py-2 pr-4">Thickness (mm)</th>
              <th className="py-2 pr-4">n</th>
              <th className="py-2 pr-4">Diameter (mm)</th>
              <th className="py-2 pr-4">Material</th>
              <th className="py-2 pr-3" title="Radius ± (mm)">R ±</th>
              <th className="py-2 pr-3" title="Thickness ± (mm)">T ±</th>
              <th className="py-2 pr-3" title="Tilt ± (deg)">Tilt ±</th>
              <th className="py-2 pr-3" title="Absorption (1/cm) thermal">α</th>
              <th className="py-2 pr-3" title="ISO 10110 scratch/dig">S/D</th>
              <th className="py-2 w-10" />
            </tr>
          </thead>
          <Droppable droppableId="surfaces">
            {(provided) => (
          <tbody
            ref={provided.innerRef}
            {...provided.droppableProps}
          >
            <tr
              data-testid="insert-surface-at-start"
              onClick={addSurfaceAtStart}
              className="border-b border-dashed border-white/20 cursor-pointer bg-slate-900/30 backdrop-blur-[4px] hover:bg-slate-900/50 text-slate-500 hover:text-cyan-electric transition-colors"
            >
              <td colSpan={14} className="py-2">
                <span className="flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  Insert surface at start
                </span>
              </td>
            </tr>
            {surfaces.map((s, i) => {
              const isHighSensitivity = highSensitivityIndices.has(i)
              return (
              <Draggable key={s.id} draggableId={s.id} index={i}>
                {(provided, snapshot) => (
                <motion.tr
                  ref={provided.innerRef}
                  {...provided.draggableProps}
                  onClick={() => onSelectSurface(s.id)}
                  title={isHighSensitivity ? 'High Sensitivity: Consider tightening tolerances or choosing a different glass type here' : undefined}
                  className={`border-b border-white/10 cursor-pointer transition-all backdrop-blur-[4px] ${
                    snapshot.isDragging ? 'opacity-90 shadow-lg' : ''
                  } ${
                    selectedSurfaceId === s.id
                      ? 'border-l-4 border-l-cyan-electric bg-slate-900/50'
                      : 'border-l-4 border-l-transparent hover:bg-slate-900/50'
                  } ${isHighSensitivity ? 'bg-red-500/10' : 'bg-slate-900/30'}`}
                  animate={isHighSensitivity ? {
                    backgroundColor: [
                      'rgba(239, 68, 68, 0.08)',
                      'rgba(239, 68, 68, 0.18)',
                      'rgba(239, 68, 68, 0.08)',
                    ],
                  } : {}}
                  transition={isHighSensitivity ? {
                    duration: 2.5,
                    repeat: Infinity,
                    repeatType: 'reverse',
                  } : {}}
                >
                <td
                  {...provided.dragHandleProps}
                  className="py-2 pr-1 text-slate-500 hover:text-cyan-electric cursor-grab active:cursor-grabbing"
                  onClick={(e) => e.stopPropagation()}
                >
                  <GripVertical className="w-4 h-4" />
                </td>
                <td className="py-2 pr-4 text-slate-400">{i + 1}</td>
                <td className="py-2 pr-4">
                  <div className="flex gap-1">
                    <select
                      value={s.type}
                      onChange={(e) => updateSurface(s.id, { type: e.target.value as 'Glass' | 'Air' })}
                      onClick={(e) => e.stopPropagation()}
                      className={inputClass}
                    >
                      <option value="Glass">Glass</option>
                      <option value="Air">Air</option>
                    </select>
                    <select
                      value=""
                      onChange={(e) => {
                        const v = e.target.value
                        if (!v) return
                        e.target.value = ''
                        const preset = SURFACE_PRESETS.find((p) => p.name === v)
                        if (preset) {
                          updateSurface(s.id, {
                            type: 'Glass',
                            radius: preset.radius,
                            thickness: preset.thickness,
                          })
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className={`${inputClass} min-w-[7rem] text-slate-500`}
                      title="Quick Actions"
                    >
                      <option value="">Presets</option>
                      {SURFACE_PRESETS.map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </td>
                <td className="py-2 pr-4">
                  <input
                    type="number"
                    value={s.radius}
                    onChange={(e) => updateSurface(s.id, { radius: Number(e.target.value) || 0 })}
                    onClick={(e) => e.stopPropagation()}
                    className={numericInputClass}
                  />
                </td>
                <td className="py-2 pr-4">
                  <input
                    type="number"
                    value={s.thickness}
                    onChange={(e) => updateSurface(s.id, { thickness: Number(e.target.value) || 0 })}
                    onClick={(e) => e.stopPropagation()}
                    className={numericInputClass}
                  />
                </td>
                <td className="py-2 pr-4">
                  <input
                    type="number"
                    value={s.refractiveIndex}
                    onChange={(e) => updateSurface(s.id, { refractiveIndex: Number(e.target.value) || 1 })}
                    onClick={(e) => e.stopPropagation()}
                    className={numericInputClass}
                    step={0.01}
                  />
                </td>
                <td className="py-2 pr-4">
                  <input
                    type="number"
                    value={s.diameter}
                    onChange={(e) => updateSurface(s.id, { diameter: Number(e.target.value) || 0 })}
                    onClick={(e) => e.stopPropagation()}
                    className={numericInputClass}
                  />
                </td>
                <td className="py-2 pr-4 overflow-visible">
                  <MaterialCombobox
                    value={s.material}
                    materials={glassMaterials}
                    onChange={(material, n) =>
                      updateSurface(s.id, {
                        material,
                        ...(n != null && { refractiveIndex: n }),
                        type: material === 'Air' ? 'Air' : 'Glass',
                      })
                    }
                    onClick={(e) => e.stopPropagation()}
                  />
                </td>
                <td className="py-2 pr-3">
                  <input
                    type="number"
                    value={s.radiusTolerance ?? ''}
                    placeholder="0"
                    min={0}
                    step={0.01}
                    onChange={(e) =>
                      updateSurface(s.id, {
                        radiusTolerance: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                    onClick={(e) => e.stopPropagation()}
                    className={`${numericInputClass} min-w-[3.5rem]`}
                    title="Radius tolerance ± (mm)"
                  />
                </td>
                <td className="py-2 pr-3">
                  <input
                    type="number"
                    value={s.thicknessTolerance ?? ''}
                    placeholder="0"
                    min={0}
                    step={0.01}
                    onChange={(e) =>
                      updateSurface(s.id, {
                        thicknessTolerance: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                    onClick={(e) => e.stopPropagation()}
                    className={`${numericInputClass} min-w-[3.5rem]`}
                    title="Thickness tolerance ± (mm)"
                  />
                </td>
                <td className="py-2 pr-3">
                  <input
                    type="number"
                    value={s.tiltTolerance ?? ''}
                    placeholder="0"
                    min={0}
                    step={0.01}
                    onChange={(e) =>
                      updateSurface(s.id, {
                        tiltTolerance: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                    onClick={(e) => e.stopPropagation()}
                    className={`${numericInputClass} min-w-[3.5rem]`}
                    title="Tilt tolerance ± (deg)"
                  />
                </td>
                <td className="py-2 pr-3">
                  {s.type === 'Glass' ? (
                    <input
                      type="number"
                      value={s.absorptionCoefficient ?? ''}
                      placeholder="0"
                      min={0}
                      step={0.001}
                      onChange={(e) =>
                        updateSurface(s.id, {
                          absorptionCoefficient: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                      onClick={(e) => e.stopPropagation()}
                      className={`${numericInputClass} min-w-[3.5rem]`}
                      title="Absorption coefficient (1/cm) for thermal lensing"
                    />
                  ) : (
                    <span className="text-slate-600 text-xs">—</span>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <input
                    type="text"
                    value={s.surfaceQuality ?? ''}
                    placeholder="3/2"
                    onChange={(e) =>
                      updateSurface(s.id, {
                        surfaceQuality: e.target.value.trim() || undefined,
                      })
                    }
                    onClick={(e) => e.stopPropagation()}
                    className={`${inputClass} min-w-[3rem]`}
                    title="Surface quality (scratch/dig) per ISO 10110"
                  />
                </td>
                <td className="py-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeSurface(s.id)
                    }}
                    className="p-1.5 rounded text-slate-500 hover:text-red-400 hover:bg-white/5"
                    aria-label="Remove surface"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </motion.tr>
                )}
              </Draggable>
            );
            })}
            {provided.placeholder}
            <tr
              data-testid="insert-surface-at-end"
              onClick={() => addSurfaceAtIndex(surfaces.length)}
              className="border-b border-dashed border-white/20 cursor-pointer bg-slate-900/30 backdrop-blur-[4px] hover:bg-slate-900/50 text-slate-500 hover:text-cyan-electric transition-colors"
            >
              <td colSpan={14} className="py-2">
                <span className="flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  Insert surface at end
                </span>
              </td>
            </tr>
          </tbody>
            )}
          </Droppable>
        </table>
        </DragDropContext>
      </div>
    </div>
  )
}
