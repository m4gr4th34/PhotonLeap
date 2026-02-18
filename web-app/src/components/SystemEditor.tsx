import { useState, useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Plus, Trash2, Download, Upload } from 'lucide-react'
import type { SystemState, Surface } from '../types/system'
import {
  MATERIAL_PRESETS,
  getPresetForIndex,
  getIndexForPreset,
} from '../lib/materials'

type SystemEditorProps = {
  systemState: SystemState
  onSystemStateChange: (state: SystemState | ((prev: SystemState) => SystemState)) => void
  onLoadComplete?: (fileName: string) => void
  selectedSurfaceId: string | null
  onSelectSurface: (id: string | null) => void
}

const inputClass =
  'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-electric focus:ring-1 focus:ring-cyan-electric/30 transition-colors'

const selectClass =
  'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-electric focus:ring-1 focus:ring-cyan-electric/30 transition-colors appearance-none cursor-pointer'

type MaterialSelectProps = {
  surface: Surface
  isCustomMode: boolean
  onUpdate: (n: number, material: string, type: 'Glass' | 'Air') => void
  onSetCustomMode: (custom: boolean) => void
}

function MaterialSelect({
  surface,
  isCustomMode,
  onUpdate,
  onSetCustomMode,
}: MaterialSelectProps) {
  const preset = getPresetForIndex(surface.refractiveIndex)
  const showCustomInput = isCustomMode || preset === 'custom'

  const handlePresetChange = (value: string) => {
    if (value === 'custom') {
      const n = showCustomInput ? surface.refractiveIndex : 1.5
      onUpdate(n, `n=${n.toFixed(4)}`, n > 1.01 ? 'Glass' : 'Air')
      onSetCustomMode(true)
      return
    }
    onSetCustomMode(false)
    const n = getIndexForPreset(value)
    const p = MATERIAL_PRESETS.find((x) => x.value === value)
    const material = p ? p.label.split(' ')[0] : 'Air'
    onUpdate(n, material, n > 1.01 ? 'Glass' : 'Air')
  }

  const handleCustomChange = (val: string) => {
    const n = parseFloat(val) || 1
    const clamped = Math.max(1, Math.min(3, n))
    onUpdate(clamped, `n=${clamped.toFixed(4)}`, clamped > 1.01 ? 'Glass' : 'Air')
  }

  return (
    <div className="flex flex-col gap-1.5 min-w-[140px]">
      <select
        value={preset}
        onChange={(e) => handlePresetChange(e.target.value)}
        className={selectClass}
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2394a3b8'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`,
          backgroundSize: '1rem',
          backgroundPosition: 'right 0.5rem center',
          backgroundRepeat: 'no-repeat',
          paddingRight: '2rem',
        }}
      >
        {MATERIAL_PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
        <option value="custom">Custom...</option>
      </select>
      {showCustomInput && (
        <input
          type="number"
          value={surface.refractiveIndex}
          onChange={(e) => handleCustomChange(e.target.value)}
          min={1}
          max={3}
          step={0.001}
          className={inputClass}
          placeholder="n"
          autoFocus
        />
      )}
    </div>
  )
}

const APP_VERSION = '0.0.0'

/** Save design using File System Access API for native "Save As" experience. */
async function saveDesign(systemState: SystemState): Promise<void> {
  const data = {
    optical_stack: {
      surfaces: systemState.surfaces,
      numRays: systemState.numRays,
    },
    system_parameters: {
      entrancePupilDiameter: systemState.entrancePupilDiameter,
      wavelengths: systemState.wavelengths,
      fieldAngles: systemState.fieldAngles,
    },
    system_properties: {
      totalLength: systemState.totalLength,
      fNumber: systemState.fNumber,
      rmsSpotRadius: systemState.rmsSpotRadius,
    },
    metadata: {
      savedAt: new Date().toISOString(),
      appVersion: APP_VERSION,
    },
  }
  const json = JSON.stringify(data, null, 2)

  if (!('showSaveFilePicker' in window)) {
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'my_optical_design.json'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    return
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handle = await (window as any).showSaveFilePicker({
      suggestedName: 'my_optical_design.json',
      types: [
        {
          description: 'JSON Files',
          accept: { 'application/json': ['.json'] },
        },
      ],
    })
    const writable = await handle.createWritable()
    await writable.write(json)
    await writable.close()
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return
    }
    throw err
  }
}

/** Normalize a loaded surface to ensure all fields exist and ID is unique. */
function normalizeSurface(s: Partial<Surface> & { n?: number }, _index: number): Surface {
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

/** Create a new surface with unique ID. Defaults to Air (n=1.0) so the physics engine knows the ray medium. */
function createSurface(): Surface {
  return {
    id: crypto.randomUUID(),
    type: 'Air',
    radius: 0,
    thickness: 10,
    refractiveIndex: 1.0,
    diameter: 25,
    material: 'Air',
    description: '',
  }
}

type LoadedStack = {
  surfaces?: unknown[]
  numRays?: number
  entrancePupilDiameter?: number
  wavelengths?: unknown
  fieldAngles?: unknown
}

type LoadedParams = {
  entrancePupilDiameter?: number
  wavelengths?: unknown
  fieldAngles?: unknown
}

function applyLoadedData(
  data: unknown,
  onSystemStateChange: SystemEditorProps['onSystemStateChange']
) {
  const raw = data as {
    optical_stack?: LoadedStack
    system_parameters?: LoadedParams
    system_properties?: { totalLength?: number; fNumber?: number; rmsSpotRadius?: number }
  }
  const stack: LoadedStack = raw.optical_stack ?? (raw as unknown as LoadedStack)
  const params: LoadedParams = raw.system_parameters ?? stack
  const props = raw.system_properties ?? {}

  const loadedSurfaces = Array.isArray(stack.surfaces)
    ? stack.surfaces.filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
    : []
  const normalizedSurfaces = loadedSurfaces.map((s, i) =>
    normalizeSurface(s as Partial<Surface> & { n?: number }, i)
  )

  const entrancePupilDiameter =
    Number(params.entrancePupilDiameter ?? stack.entrancePupilDiameter) || 10
  const wavelengthsArr = params.wavelengths ?? stack.wavelengths
  const wavelengths = Array.isArray(wavelengthsArr) ? wavelengthsArr.map(Number) : undefined
  const fieldAnglesArr = params.fieldAngles ?? stack.fieldAngles
  const fieldAngles = Array.isArray(fieldAnglesArr) ? fieldAnglesArr.map(Number) : undefined

  onSystemStateChange((prev) => ({
    ...prev,
    surfaces: normalizedSurfaces.length ? normalizedSurfaces : prev.surfaces,
    entrancePupilDiameter,
    wavelengths: wavelengths ?? prev.wavelengths,
    fieldAngles: fieldAngles ?? prev.fieldAngles,
    numRays: Number(stack.numRays ?? prev.numRays) || 9,
    totalLength: Number(props.totalLength ?? prev.totalLength) || 0,
    fNumber: Number(props.fNumber ?? prev.fNumber) || 0,
    rmsSpotRadius: Number(props.rmsSpotRadius ?? prev.rmsSpotRadius) || 0,
    traceResult: null,
    traceError: null,
  }))
}

export function SystemEditor({
  systemState,
  onSystemStateChange,
  onLoadComplete,
  selectedSurfaceId,
  onSelectSurface,
}: SystemEditorProps) {
  const surfaces = systemState.surfaces
  const [customMaterialIds, setCustomMaterialIds] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  const handleLoadDesign = async () => {
    if ('showOpenFilePicker' in window) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [handle] = await (window as any).showOpenFilePicker({
          types: [{ description: 'JSON file', accept: { 'application/json': ['.json'] } }],
          multiple: false,
        })
        const file = await handle.getFile()
        const text = await file.text()
        const data = JSON.parse(text)
        applyLoadedData(data, onSystemStateChange)
        onLoadComplete?.(handle.name)
        onSelectSurface(null)
        setToast('Success')
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        setToast('Invalid file')
      }
      return
    }
    fileInputRef.current?.click()
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const text = reader.result as string
        const data = JSON.parse(text)
        applyLoadedData(data, onSystemStateChange)
        onLoadComplete?.(file.name)
        onSelectSurface(null)
        setToast('Success')
      } catch {
        setToast('Invalid file')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const updateSurface = (index: number, partial: Partial<Surface>) => {
    onSystemStateChange((prev) => ({
      ...prev,
      surfaces: prev.surfaces.map((s, i) =>
        i === index ? { ...s, ...partial } : s
      ),
    }))
  }

  const updateMaterial = (index: number, n: number, material: string, type: 'Glass' | 'Air') => {
    updateSurface(index, { refractiveIndex: n, material, type })
  }

  const removeSurface = (index: number) => {
    if (surfaces.length <= 1) return
    const idToRemove = surfaces[index]?.id
    if (idToRemove) {
      if (selectedSurfaceId === idToRemove) onSelectSurface(null)
      setCustomMaterialIds((prev) => {
        const next = new Set(prev)
        next.delete(idToRemove)
        return next
      })
    }
    onSystemStateChange((prev) => ({
      ...prev,
      surfaces: prev.surfaces.filter((_, i) => i !== index),
    }))
  }

  const addSurface = () => {
    const newSurface = createSurface()
    const selectedIndex = selectedSurfaceId
      ? surfaces.findIndex((s) => s.id === selectedSurfaceId)
      : -1
    const insertIndex = selectedIndex >= 0 ? selectedIndex + 1 : surfaces.length

    onSystemStateChange((prev) => ({
      ...prev,
      surfaces: [
        ...prev.surfaces.slice(0, insertIndex),
        newSurface,
        ...prev.surfaces.slice(insertIndex),
      ],
    }))
    onSelectSurface(newSurface.id)
  }

  const columns = [
    { key: 'num', label: '#', width: 'w-12' },
    { key: 'radius', label: 'Radius (mm)', width: 'w-24' },
    { key: 'thickness', label: 'Thickness (mm)', width: 'w-28' },
    { key: 'materialIndex', label: 'Material/Index', width: 'w-36' },
    { key: 'diameter', label: 'Diameter (mm)', width: 'w-24' },
    { key: 'description', label: 'Description', width: 'flex-1' },
    { key: 'actions', label: '', width: 'w-12' },
  ] as const

  return (
    <div className="h-full flex flex-col relative">
      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-lg font-medium shadow-lg transition-opacity ${
            toast === 'Success'
              ? 'bg-emerald-500/90 text-white'
              : 'bg-red-500/90 text-white'
          }`}
        >
          {toast === 'Success' ? 'Design loaded successfully' : 'Invalid file'}
        </div>
      )}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-cyan-electric font-semibold text-lg">
          Optical Stack
        </h2>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileInputChange}
            className="hidden"
          />
          <button
            onClick={handleLoadDesign}
            className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all border border-cyan-electric/50 text-cyan-electric hover:bg-cyan-electric/10"
          >
            <Upload className="w-5 h-5" strokeWidth={2} />
            Load Design
          </button>
          <button
            onClick={async () => {
              try {
                await saveDesign(systemState)
              } catch {
                setToast('Save failed')
              }
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all border border-cyan-electric/50 text-cyan-electric hover:bg-cyan-electric/10"
          >
            <Download className="w-5 h-5" strokeWidth={2} />
            Save Design
          </button>
          <button
            onClick={addSurface}
            className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all"
            style={{
              background: 'linear-gradient(135deg, #22D3EE 0%, #0891b2 100%)',
              color: '#0B1120',
              boxShadow: '0 0 24px rgba(34, 211, 238, 0.3)',
            }}
          >
            <Plus className="w-5 h-5" strokeWidth={2} />
            New Surface
          </button>
        </div>
      </div>

      <div className="glass-card overflow-hidden flex-1 min-h-0">
        <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-220px)]">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10 bg-midnight/95 backdrop-blur border-b border-white/10">
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={`${col.width} px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {surfaces.map((s, i) => (
                <motion.tr
                  key={s.id}
                  layout
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('input, button, select')) return
                    onSelectSurface(s.id)
                  }}
                  className={`cursor-pointer transition-colors ${
                    selectedSurfaceId === s.id
                      ? 'bg-cyan-electric/20 ring-1 ring-cyan-electric/50'
                      : 'hover:bg-white/5'
                  }`}
                >
                  <td className="px-4 py-3 text-slate-400 font-mono text-sm">
                    {i + 1}
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      value={s.radius}
                      onChange={(e) =>
                        updateSurface(i, {
                          radius: Number(e.target.value) || 0,
                        })
                      }
                      className={inputClass}
                      step={1}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      value={s.thickness}
                      onChange={(e) =>
                        updateSurface(i, {
                          thickness: Number(e.target.value) || 0,
                        })
                      }
                      className={inputClass}
                      min={0}
                      step={0.1}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <MaterialSelect
                      surface={s}
                      isCustomMode={customMaterialIds.has(s.id)}
                      onUpdate={(n, material, type) =>
                        updateMaterial(i, n, material, type)
                      }
                      onSetCustomMode={(custom) => {
                        setCustomMaterialIds((prev) => {
                          const next = new Set(prev)
                          if (custom) next.add(s.id)
                          else next.delete(s.id)
                          return next
                        })
                      }}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      value={s.diameter}
                      onChange={(e) =>
                        updateSurface(i, {
                          diameter: Number(e.target.value) || 0,
                        })
                      }
                      className={inputClass}
                      min={0}
                      step={0.5}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="text"
                      value={s.description}
                      onChange={(e) =>
                        updateSurface(i, { description: e.target.value })
                      }
                      className={inputClass}
                      placeholder="Optional notes..."
                    />
                  </td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => removeSurface(i)}
                      disabled={surfaces.length <= 1}
                      className="p-2 rounded text-slate-500 hover:text-red-400 hover:bg-white/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-slate-500"
                      aria-label="Remove surface"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
