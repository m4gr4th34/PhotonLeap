import { useRef, useEffect, useLayoutEffect, useState } from 'react'
import ReactDOM from 'react-dom'
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, GripVertical, Plus, Trash2, Search, FileUp, Save, FolderOpen, X } from 'lucide-react'
import type { SystemState, Surface } from '../types/system'
import { config } from '../config'
import { fetchMaterials, nFromCoeffs, type MaterialOption } from '../api/materials'
import { fetchCoatings, COATINGS_FALLBACK, fetchReflectivityCurve, getCoatingSwatchStyle, fetchCoatingDefinition, type CoatingOption, type ReflectivityPoint } from '../api/coatings'
import { ReflectivityCurveGraph } from './ReflectivityCurveGraph'
import { importLensSystem } from '../api/importLens'
import { toLensX, parseLensXFile, type CustomCoatingData } from '../lib/lensX'

/** Fallback when API is unavailable */
const GLASS_LIBRARY_FALLBACK: MaterialOption[] = [
  { name: 'Air', n: 1 },
  { name: 'N-BK7', n: 1.5168 },
  { name: 'Fused Silica', n: 1.458 },
  { name: 'N-SF11', n: 1.78472 },
  { name: 'N-SF5', n: 1.6727 },
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
const COMMON_COATINGS = ['Uncoated', 'MgF2', 'BBAR']

function MaterialCombobox({
  value,
  onChange,
  onClick,
  materials,
  wavelengthNm,
  fallbackN,
}: {
  value: string
  onChange: (material: string, n?: number) => void
  onClick?: (e: React.MouseEvent) => void
  materials: MaterialOption[]
  wavelengthNm: number
  fallbackN: number
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

  const mat = materials.find((m) => m.name.toLowerCase() === value.toLowerCase())
  const displayN =
    mat?.coefficients
      ? nFromCoeffs(wavelengthNm, mat.coefficients)
      : fallbackN

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
    <div className="flex items-center gap-2">
      <div className="flex gap-0.5 flex-1 min-w-0">
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
      </div>
      <span
        className="shrink-0 text-xs font-mono tabular-nums text-slate-500 min-w-[3.5rem]"
        title={`n at ${(wavelengthNm / 1000).toFixed(3)} µm`}
      >
        n≈{displayN.toFixed(3)}
      </span>
      {dropdownContent}
    </div>
  )
}

function CoatingCombobox({
  value,
  onChange,
  onClick,
  coatings,
  wavelengthNm,
  wavelengths,
}: {
  value: string
  onChange: (coating: string) => void
  onClick?: (e: React.MouseEvent) => void
  coatings: CoatingOption[]
  wavelengthNm: number
  wavelengths: number[]
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hoveredCoating, setHoveredCoating] = useState<string | null>(null)
  const [curveCache, setCurveCache] = useState<Record<string, ReflectivityPoint[]>>({})
  const [curveLoading, setCurveLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const portalRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 })

  const displayValue = value === 'None' || !value ? 'Uncoated' : value

  const minNm = wavelengths.length ? Math.max(350, Math.min(...wavelengths) - 80) : 400
  const maxNm = wavelengths.length ? Math.min(1200, Math.max(...wavelengths) + 80) : 700

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
    ? coatings.filter((c) =>
        c.name.toLowerCase().includes(query.toLowerCase()) ||
        (c.description && c.description.toLowerCase().includes(query.toLowerCase()))
      )
    : coatings

  const commonFiltered = filtered.filter((c) => COMMON_COATINGS.includes(c.name))
  const restFiltered = filtered.filter((c) => !COMMON_COATINGS.includes(c.name))

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
      setQuery('')
      setIsOpen(false)
      setHoveredCoating(null)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  useEffect(() => {
    if (!hoveredCoating) return
    if (curveCache[hoveredCoating]) return
    let cancelled = false
    setCurveLoading(true)
    fetchReflectivityCurve(hoveredCoating, minNm, maxNm, 5).then((pts) => {
      if (!cancelled) setCurveCache((p) => ({ ...p, [hoveredCoating]: pts }))
      setCurveLoading(false)
    }).catch(() => setCurveLoading(false))
    return () => { cancelled = true }
  }, [hoveredCoating, minNm, maxNm, curveCache])

  const handleSelect = (c: CoatingOption) => {
    onChange(c.name)
    setQuery('')
    setIsOpen(false)
  }

  const renderOption = (c: CoatingOption) => (
    <div
      key={c.name}
      className="relative"
      onMouseEnter={() => setHoveredCoating(c.name)}
      onMouseLeave={() => setHoveredCoating(null)}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          handleSelect(c)
        }}
        className="w-full text-left px-2 py-1.5 text-sm hover:bg-cyan-electric/20 text-slate-200 rounded flex items-center gap-2"
      >
        <span
          className="shrink-0 w-3 h-3 rounded-full border border-white/20"
          style={getCoatingSwatchStyle(c.name)}
          title={c.description}
        />
        <span>{c.name}</span>
      </button>
    </div>
  )

  const dropdownWidth = Math.max(position.width, 192)
  const graphPopover =
    isOpen &&
    hoveredCoating &&
    ReactDOM.createPortal(
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15 }}
        className="fixed z-[10000] rounded-lg border border-slate-700 bg-slate-900/95 shadow-2xl backdrop-blur-xl p-2"
        style={{
          top: position.top + 4,
          left: position.left + dropdownWidth + 8,
        }}
      >
        {curveLoading ? (
          <div className="w-[180px] h-[80px] flex items-center justify-center text-slate-500 text-xs">
            Loading…
          </div>
        ) : curveCache[hoveredCoating] ? (
          <ReflectivityCurveGraph
            points={curveCache[hoveredCoating]}
            systemWavelengthNm={wavelengthNm}
            minNm={minNm}
            maxNm={maxNm}
            coatingName={hoveredCoating}
          />
        ) : null}
      </motion.div>,
      document.body
    )

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
          width: dropdownWidth,
        }}
      >
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-700 bg-slate-900/95 px-2 py-1.5">
          <Search className="w-4 h-4 shrink-0 text-slate-400" strokeWidth={2} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search coatings..."
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
              {commonFiltered.map(renderOption)}
            </div>
          )}
          {restFiltered.length > 0 && (
            <div className="px-2 py-1">
              {commonFiltered.length > 0 && (
                <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500 mb-0.5">
                  All
                </div>
              )}
              {restFiltered.map(renderOption)}
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
    <div className="flex items-center gap-2 flex-1 min-w-0">
      <div className="flex gap-0.5 flex-1 min-w-0">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={isOpen ? query : displayValue}
            onChange={(e) => {
              setQuery(e.target.value)
              if (!isOpen) setIsOpen(true)
            }}
            onFocus={() => {
              setQuery(displayValue)
              setIsOpen(true)
            }}
            onClick={onClick}
            placeholder="Coating..."
            className={`${inputClass} pl-8`}
          />
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            if (!isOpen) {
              setQuery(displayValue)
              updatePosition.current()
              setTimeout(() => inputRef.current?.focus(), 0)
            }
            setIsOpen((o) => !o)
          }}
          className="p-1 rounded bg-white/5 border border-white/10 text-slate-400 hover:text-cyan-electric shrink-0"
          aria-label="Toggle coating list"
        >
          <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} strokeWidth={2} />
        </button>
      </div>
      <span
        className="shrink-0 w-3 h-3 rounded-full border border-white/20"
        style={getCoatingSwatchStyle(displayValue)}
        title={coatings.find((c) => c.name === displayValue)?.description}
      />
      {dropdownContent}
      {graphPopover}
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
  const [coatings, setCoatings] = useState<CoatingOption[]>(COATINGS_FALLBACK)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [importPreview, setImportPreview] = useState<{
    surfaces: Surface[]
    insertIndex: number
  } | null>(null)
  const [ignoredImportIds, setIgnoredImportIds] = useState<Set<string>>(new Set())
  const [loadConfirmPending, setLoadConfirmPending] = useState<{
    content: string
    fileName: string
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const loadFileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchMaterials().then(setGlassMaterials)
  }, [])
  useEffect(() => {
    fetchCoatings().then(setCoatings)
  }, [])

  useEffect(() => {
    if (!toastMessage) return
    const t = setTimeout(() => setToastMessage(null), config.toastDuration)
    return () => clearTimeout(t)
  }, [toastMessage])

  const activeIndex =
    selectedSurfaceId != null
      ? surfaces.findIndex((s) => s.id === selectedSurfaceId)
      : surfaces.length
  const insertIndex = activeIndex >= 0 ? activeIndex : surfaces.length

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleLoadClick = () => {
    loadFileInputRef.current?.click()
  }

  const handleLoadFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const isLensX = file.name.toLowerCase().endsWith('.lensx') || file.name.toLowerCase().endsWith('.json')
    if (!isLensX) {
      setToastMessage('Please select a .lensx or .json file.')
      return
    }
    try {
      const content = await file.text()
      parseLensXFile(content)
      setLoadConfirmPending({ content, fileName: file.name })
    } catch (err) {
      setToastMessage(err instanceof Error ? err.message : 'Invalid LENS-X file')
    }
  }

  const handleLoadConfirm = () => {
    if (!loadConfirmPending) return
    try {
      const { surfaces, entrancePupilDiameter, wavelengths, projectName, mc_iterations, mc_seed, target_yield, hasTolerancesData } =
        parseLensXFile(loadConfirmPending.content)
      onSystemStateChange((prev) => ({
        ...prev,
        surfaces,
        entrancePupilDiameter,
        wavelengths,
        projectName,
        ...(mc_iterations != null && { mc_iterations }),
        ...(mc_seed != null && { mc_seed }),
        ...(target_yield != null && { target_yield }),
        traceResult: null,
        traceError: null,
        pendingTrace: true,
      }))
      setToastMessage(hasTolerancesData ? 'Project loaded successfully.' : 'Project loaded without tolerance data.')
      setLoadConfirmPending(null)
    } catch (err) {
      setToastMessage(err instanceof Error ? err.message : 'Failed to load project')
    }
  }

  const handleLoadCancel = () => {
    setLoadConfirmPending(null)
  }

  const handleSaveProject = async () => {
    const dateStr = new Date().toISOString().slice(0, 10)
    const customCoatingData: CustomCoatingData = {}
    const names = [...new Set(surfaces.map((s) => s.coating).filter(Boolean) as string[])]
    for (const name of names) {
      const s = surfaces.find((surf) => surf.coating === name)
      if (s?.coatingDataPoints != null || s?.coatingConstantValue != null) continue
      const def = await fetchCoatingDefinition(name)
      if (def) {
        customCoatingData[name] = {
          data_type: def.data_type,
          constant_value: def.constant_value,
          data_points: def.data_points,
          is_hr: def.is_hr,
        }
      }
    }
    const doc = toLensX(surfaces, {
      projectName: systemState.projectName ?? 'Untitled',
      date: dateStr,
      drawnBy: 'MacOptics',
      entrancePupilDiameter: systemState.entrancePupilDiameter,
      referenceWavelengthNm: systemState.wavelengths[0] ?? 587.6,
      mcIterations: systemState.mc_iterations ?? 1000,
      mcSeed: systemState.mc_seed ?? 42,
      targetYield: systemState.target_yield ?? 0.95,
      customCoatingData,
    })
    const blob = new Blob([JSON.stringify(doc, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `project_${dateStr}.lensx`
    a.click()
    URL.revokeObjectURL(url)
    setToastMessage('Project saved successfully as Lens-X.')
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setToastMessage('Processing Drawing...')
    try {
      const { surfaces: imported } = await importLensSystem(file)
      setToastMessage(null)
      if (imported.length === 0) {
        setToastMessage('No surfaces found in file.')
        return
      }
      setIgnoredImportIds(new Set())
      setImportPreview({ surfaces: imported, insertIndex })
    } catch (err) {
      setToastMessage(err instanceof Error ? err.message : 'Import failed')
    }
  }

  const toggleImportIgnore = (id: string) => {
    setIgnoredImportIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** Heuristic: surface looks like text/arrow annotation (small diameter, thin line, or description match) */
  const looksLikeAnnotation = (s: Surface): boolean => {
    const desc = (s.description || '').toLowerCase()
    const annotationPattern = /arrow|text|dimension|label|annot|axis|tick|mark/
    if (annotationPattern.test(desc)) return true
    if (s.diameter < 2.5) return true
    if (s.radius === 0 && s.thickness < 0.5) return true
    return false
  }

  const clearAllAnnotations = () => {
    if (!importPreview) return
    const toIgnore = importPreview.surfaces
      .filter(looksLikeAnnotation)
      .map((s) => s.id)
    setIgnoredImportIds((prev) => {
      const next = new Set(prev)
      toIgnore.forEach((id) => next.add(id))
      return next
    })
  }

  const confirmImport = () => {
    if (!importPreview) return
    const toAdd = importPreview.surfaces.filter((s) => !ignoredImportIds.has(s.id))
    if (toAdd.length > 0) {
      onSystemStateChange((prev) => {
        const next = [...prev.surfaces]
        next.splice(importPreview.insertIndex, 0, ...toAdd)
        return {
          ...prev,
          surfaces: next,
          traceResult: null,
          traceError: null,
        }
      })
      setToastMessage(
        toAdd.length > 1
          ? `Imported ${toAdd.length} surfaces from ISO drawing.`
          : 'Imported 1 surface from ISO drawing.'
      )
    }
    setImportPreview(null)
    setIgnoredImportIds(new Set())
  }

  const cancelImport = () => {
    setImportPreview(null)
    setIgnoredImportIds(new Set())
  }

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
      coating: 'Uncoated',
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
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-cyan-electric font-semibold text-lg">System Editor</h2>
          <div className="flex items-center gap-2 rounded-lg bg-slate-800/50 backdrop-blur-sm border border-white/10 px-2 py-1.5">
            <input
              ref={loadFileInputRef}
              type="file"
              accept=".lensx,.json"
              onChange={handleLoadFileChange}
              className="hidden"
              aria-hidden
            />
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.svg,.csv"
              onChange={handleFileChange}
              className="hidden"
              aria-hidden
            />
            <button
              type="button"
              onClick={handleLoadClick}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium text-slate-200 hover:text-cyan-electric hover:bg-white/5 transition-colors"
            >
              <FolderOpen className="w-4 h-4" />
              Load Project
            </button>
            <button
              type="button"
              onClick={handleSaveProject}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium text-slate-200 hover:text-cyan-electric hover:bg-white/5 transition-colors"
            >
              <Save className="w-4 h-4" />
              Save Project
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-slate-800/50 backdrop-blur-sm border border-white/10 px-2 py-1.5">
          <button
            type="button"
            onClick={handleImportClick}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium text-slate-200 hover:text-cyan-electric hover:bg-white/5 transition-colors"
          >
            <FileUp className="w-4 h-4" />
            Add Surface from File
          </button>
        </div>
      </div>
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
              <th className="py-2 pr-3" title="Coating (affects power loss)">Coating</th>
              <th className="py-2 pr-3" title="Radius ± (mm)">R ±</th>
              <th className="py-2 pr-3" title="Thickness ± (mm)">T ±</th>
              <th className="py-2 pr-3" title="Tilt ± (deg)">Tilt ±</th>
              <th className="py-2 pr-3" title="Decenter X (mm)">Dec X</th>
              <th className="py-2 pr-3" title="Decenter Y (mm)">Dec Y</th>
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
              <td colSpan={17} className="py-2">
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
                  layout
                  initial={{ opacity: 0, y: -8 }}
                  animate={
                    isHighSensitivity
                      ? {
                          opacity: 1,
                          y: 0,
                          backgroundColor: [
                            'rgba(239, 68, 68, 0.08)',
                            'rgba(239, 68, 68, 0.18)',
                            'rgba(239, 68, 68, 0.08)',
                          ],
                        }
                      : { opacity: 1, y: 0 }
                  }
                  transition={
                    isHighSensitivity
                      ? {
                          duration: 2.5,
                          repeat: Infinity,
                          repeatType: 'reverse',
                        }
                      : { duration: 0.2 }
                  }
                  className={`border-b border-white/10 cursor-pointer transition-all backdrop-blur-[4px] ${
                    snapshot.isDragging ? 'opacity-90 shadow-lg' : ''
                  } ${
                    selectedSurfaceId === s.id
                      ? 'border-l-4 border-l-cyan-electric bg-slate-900/50'
                      : 'border-l-4 border-l-transparent hover:bg-slate-900/50'
                  } ${isHighSensitivity ? 'bg-red-500/10' : 'bg-slate-900/30'}`}
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
                  <select
                    value={s.type}
                    onChange={(e) => updateSurface(s.id, { type: e.target.value as 'Glass' | 'Air' })}
                    onClick={(e) => e.stopPropagation()}
                    className={inputClass}
                  >
                    <option value="Glass">Glass</option>
                    <option value="Air">Air</option>
                  </select>
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
                    wavelengthNm={systemState.wavelengths[0] ?? 587.6}
                    fallbackN={s.refractiveIndex}
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
                <td className="py-2 pr-3 min-w-[8rem]">
                  <CoatingCombobox
                    value={s.coating ?? ''}
                    coatings={coatings}
                    wavelengthNm={systemState.wavelengths[0] ?? 587.6}
                    wavelengths={systemState.wavelengths}
                    onChange={(coating) => updateSurface(s.id, { coating: coating || undefined })}
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
                  <input
                    type="number"
                    value={s.decenterX ?? ''}
                    placeholder="0"
                    step={0.01}
                    onChange={(e) =>
                      updateSurface(s.id, {
                        decenterX: e.target.value === '' ? undefined : Number(e.target.value) || 0,
                      })
                    }
                    onClick={(e) => e.stopPropagation()}
                    className={`${numericInputClass} min-w-[3.5rem]`}
                    title="Decenter X (mm)"
                  />
                </td>
                <td className="py-2 pr-3">
                  <input
                    type="number"
                    value={s.decenterY ?? ''}
                    placeholder="0"
                    step={0.01}
                    onChange={(e) =>
                      updateSurface(s.id, {
                        decenterY: e.target.value === '' ? undefined : Number(e.target.value) || 0,
                      })
                    }
                    onClick={(e) => e.stopPropagation()}
                    className={`${numericInputClass} min-w-[3.5rem]`}
                    title="Decenter Y (mm)"
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
              <td colSpan={17} className="py-2">
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
      {toastMessage && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-slate-800/95 border border-slate-600 text-slate-200 text-sm shadow-xl backdrop-blur-sm"
          role="status"
          aria-live="polite"
        >
          {toastMessage}
        </motion.div>
      )}
      {ReactDOM.createPortal(
        <AnimatePresence>
          {importPreview && (
          <motion.div
            key="import-preview-modal"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-xl p-4 sm:p-6"
            onClick={(e) => e.target === e.currentTarget && cancelImport()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-preview-title"
          >
            <div
              className="w-full max-w-4xl max-h-[90vh] rounded-xl border border-slate-600/80 bg-slate-900/80 shadow-2xl backdrop-blur-xl overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3 shrink-0">
                <h3 id="import-preview-title" className="text-lg font-semibold text-cyan-electric">
                  Import Preview
                </h3>
                <button
                  type="button"
                  onClick={cancelImport}
                  className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-white/5"
                  aria-label="Cancel import"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-auto p-4 min-h-0">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Section A: Surfaces to Import */}
                  <section className="space-y-3">
                    <h4 className="text-sm font-medium text-slate-300">Surfaces to Import</h4>
                    <p className="text-xs text-slate-500">
                      {importPreview.surfaces.length} surface{importPreview.surfaces.length !== 1 ? 's' : ''} found. Click a row to toggle. Green = included, gray = ignored.
                    </p>
                    <button
                      type="button"
                      onClick={clearAllAnnotations}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-slate-600"
                    >
                      Clear All Annotations
                    </button>
                    <div className="overflow-x-auto rounded-lg border border-slate-700">
                      <table className="w-full text-sm min-w-[280px]">
                        <thead>
                          <tr className="bg-slate-800/80 text-left text-slate-400">
                            <th className="py-2 px-3 w-12">Import</th>
                            <th className="py-2 px-3 w-10">#</th>
                            <th className="py-2 px-3">Radius (mm)</th>
                            <th className="py-2 px-3">Material</th>
                            <th className="py-2 px-3">Thickness (mm)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importPreview.surfaces.map((s, i) => {
                            const isIgnored = ignoredImportIds.has(s.id)
                            return (
                              <tr
                                key={s.id}
                                onClick={() => toggleImportIgnore(s.id)}
                                className={`border-t border-slate-700/80 cursor-pointer transition-colors ${
                                  isIgnored
                                    ? 'opacity-50 bg-slate-800/40 hover:bg-slate-800/60'
                                    : 'bg-emerald-500/10 hover:bg-emerald-500/10 border-l-2 border-l-emerald-500'
                                }`}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault()
                                    toggleImportIgnore(s.id)
                                  }
                                }}
                                aria-label={`Surface ${i + 1}: ${isIgnored ? 'ignored' : 'included'}, click to toggle`}
                              >
                                <td className="py-2 px-3">
                                  <input
                                    type="checkbox"
                                    checked={!isIgnored}
                                    onChange={() => toggleImportIgnore(s.id)}
                                    onClick={(e) => e.stopPropagation()}
                                    className="rounded border-slate-600 bg-slate-800 text-cyan-electric focus:ring-cyan-electric/50"
                                    aria-label={`Include surface ${i + 1}`}
                                  />
                                </td>
                                <td className="py-2 px-3 text-slate-400">{i + 1}</td>
                                <td className="py-2 px-3 text-slate-200 font-mono">
                                  {s.radius === 0 ? '∞' : s.radius.toFixed(2)}
                                </td>
                                <td className="py-2 px-3 text-slate-200">{s.material}</td>
                                <td className="py-2 px-3 text-slate-200 font-mono">
                                  {s.thickness.toFixed(2)}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  {/* Section B: Target Location with Drop Zones */}
                  <section className="space-y-3">
                    <h4 className="text-sm font-medium text-slate-300">Target Location</h4>
                    <p className="text-xs text-slate-500">
                      Click a drop zone to choose where to insert the imported surfaces.
                    </p>
                    <div className="rounded-lg border border-slate-700 overflow-hidden space-y-0">
                      {(() => {
                        const count = importPreview.surfaces.length - ignoredImportIds.size
                        const setInsertIndex = (idx: number) =>
                          setImportPreview((prev) => (prev ? { ...prev, insertIndex: idx } : null))
                        return (
                          <>
                            {/* Top of Stack */}
                            <button
                              type="button"
                              onClick={() => setInsertIndex(0)}
                              className={`w-full py-3 px-4 text-left text-sm border-2 border-dashed transition-all hover:bg-cyan-500/20 hover:shadow-[0_0_12px_rgba(34,211,238,0.12)] ${
                                importPreview.insertIndex === 0
                                  ? 'bg-cyan-500/20 border-cyan-electric/50'
                                  : 'border-slate-600/80 text-slate-400 hover:border-cyan-electric/30'
                              }`}
                            >
                              <span className="font-medium text-slate-300">Top of Stack</span>
                              <span className="block text-xs mt-0.5 text-slate-500">
                                Insert {count} surface{count !== 1 ? 's' : ''} here
                              </span>
                            </button>
                            {surfaces.map((s, i) => (
                              <div key={s.id}>
                                <div className="py-2 px-4 bg-slate-800/50 border-b border-slate-700/80 text-sm text-slate-300">
                                  {i + 1}. {s.material} — R: {s.radius === 0 ? '∞' : s.radius.toFixed(2)} mm
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setInsertIndex(i + 1)}
                                  className={`w-full py-3 px-4 text-left text-sm border-2 border-dashed transition-all hover:bg-cyan-500/20 hover:shadow-[0_0_12px_rgba(34,211,238,0.12)] ${
                                    importPreview.insertIndex === i + 1
                                      ? 'bg-cyan-500/20 border-cyan-electric/50'
                                      : 'border-slate-600/80 text-slate-400 hover:border-cyan-electric/30'
                                  }`}
                                >
                                  <span className="block text-xs text-slate-500">
                                    Insert {count} surface{count !== 1 ? 's' : ''} here
                                  </span>
                                </button>
                              </div>
                            ))}
                            {/* End of Stack */}
                            <button
                              type="button"
                              onClick={() => setInsertIndex(surfaces.length)}
                              className={`w-full py-3 px-4 text-left text-sm border-2 border-dashed transition-all hover:bg-cyan-500/20 hover:shadow-[0_0_12px_rgba(34,211,238,0.12)] ${
                                importPreview.insertIndex === surfaces.length
                                  ? 'bg-cyan-500/20 border-cyan-electric/50'
                                  : 'border-slate-600/80 text-slate-400 hover:border-cyan-electric/30'
                              }`}
                            >
                              <span className="font-medium text-slate-300">End of Stack</span>
                              <span className="block text-xs mt-0.5 text-slate-500">
                                Insert {count} surface{count !== 1 ? 's' : ''} here
                              </span>
                            </button>
                          </>
                        )
                      })()}
                    </div>
                  </section>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row justify-end gap-2 border-t border-slate-700 px-4 py-3 shrink-0">
                <button
                  type="button"
                  onClick={cancelImport}
                  className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200 hover:bg-white/5"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmImport}
                  disabled={importPreview.surfaces.length - ignoredImportIds.size === 0}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-slate-900 bg-cyan-electric hover:bg-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Confirm Import
                </button>
              </div>
            </div>
          </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
      {ReactDOM.createPortal(
        <AnimatePresence>
          {loadConfirmPending && (
            <motion.div
              key="load-confirm-modal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-xl p-4"
              onClick={(e) => e.target === e.currentTarget && handleLoadCancel()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="load-confirm-title"
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="w-full max-w-md rounded-xl border border-slate-600/80 bg-slate-900/80 shadow-2xl backdrop-blur-xl p-6"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 id="load-confirm-title" className="text-lg font-semibold text-cyan-electric mb-3">
                  Load Project
                </h3>
                <p className="text-slate-300 text-sm mb-6">
                  Loading a project will overwrite your current surfaces. Do you want to proceed?
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleLoadCancel}
                    className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200 hover:bg-white/5"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleLoadConfirm}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-slate-900 bg-cyan-electric hover:bg-cyan-400"
                  >
                    Proceed
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  )
}
