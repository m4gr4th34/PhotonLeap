/**
 * Coating Lab: Catalog browser, custom coating creator, and spectral performance graph.
 * Dark theme with slate-900, cyan-400, backdrop-blur, and glowing borders.
 */

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search,
  Plus,
  X,
  Upload,
  FileText,
  ChevronRight,
  Beaker,
  Sparkles,
} from 'lucide-react'
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts'
import {
  fetchCoatingsLibrary,
  fetchReflectivityCurve,
  createCustomCoating,
  type CoatingLibraryItem,
  type ReflectivityPoint,
  type CustomCoatingCreate,
} from '../api/coatings'

const CATEGORY_ORDER = ['AR', 'HR', 'Metallic', 'Beamsplitter', 'Specialty', 'Base', 'Custom']
const METALLIC_NAMES = ['Gold', 'Silver', 'Aluminum', 'Enhanced Silver', 'Protected Gold', 'Protected Silver', 'Protected Aluminum']

function getDisplayCategory(c: CoatingLibraryItem): string {
  if (c.category === 'HR' && METALLIC_NAMES.some((m) => c.name.includes(m))) return 'Metallic'
  return c.category
}

function groupByCategory(items: CoatingLibraryItem[]): Map<string, CoatingLibraryItem[]> {
  const map = new Map<string, CoatingLibraryItem[]>()
  for (const c of items) {
    const cat = getDisplayCategory(c)
    if (!map.has(cat)) map.set(cat, [])
    map.get(cat)!.push(c)
  }
  for (const arr of map.values()) arr.sort((a, b) => a.name.localeCompare(b.name))
  return map
}

function parseCsvToDataPoints(text: string): ReflectivityPoint[] {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 1) return []
  const sep = lines[0].includes('\t') ? '\t' : ','
  const cols = lines[0].split(sep).map((c) => c.toLowerCase().trim())
  const wlCol = cols.findIndex((c) => c.includes('wavelength') || c === 'wl' || c === 'lambda' || c === 'nm')
  const rCol = cols.findIndex((c) => c.includes('reflectivity') || c === 'r' || c === 'ref')
  const startRow = wlCol >= 0 || rCol >= 0 ? 1 : 0
  const pts: ReflectivityPoint[] = []
  for (let i = startRow; i < lines.length; i++) {
    const cells = lines[i].split(sep)
    const wl = parseFloat(cells[wlCol >= 0 ? wlCol : 0]?.trim() ?? '')
    const r = parseFloat(cells[rCol >= 0 ? rCol : 1]?.trim() ?? '')
    if (!Number.isNaN(wl) && !Number.isNaN(r)) {
      pts.push({ wavelength: wl, reflectivity: Math.max(0, Math.min(1, r)) })
    }
  }
  return pts.sort((a, b) => a.wavelength - b.wavelength)
}

type WizardStep = 'type' | 'constant' | 'table' | 'name'

export function CoatingLab() {
  const [library, setLibrary] = useState<CoatingLibraryItem[]>([])
  const [search, setSearch] = useState('')
  const [selectedCoating, setSelectedCoating] = useState<CoatingLibraryItem | null>(null)
  const [spectralData, setSpectralData] = useState<ReflectivityPoint[]>([])
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardStep, setWizardStep] = useState<WizardStep>('type')
  const [wizardMode, setWizardMode] = useState<'constant' | 'table'>('constant')
  const [constantValue, setConstantValue] = useState(0.005)
  const [tablePaste, setTablePaste] = useState('')
  const [tablePoints, setTablePoints] = useState<ReflectivityPoint[]>([])
  const [customName, setCustomName] = useState('')
  const [customDesc, setCustomDesc] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  const loadLibrary = useCallback(async () => {
    const data = await fetchCoatingsLibrary()
    setLibrary(data)
  }, [])

  useEffect(() => {
    loadLibrary()
  }, [loadLibrary])

  const loadSpectralCurve = useCallback(
    async (coating: CoatingLibraryItem | { name: string; data_points?: ReflectivityPoint[]; constant_value?: number }) => {
      const pts = (coating as { data_points?: ReflectivityPoint[] }).data_points
      const cv = (coating as { constant_value?: number }).constant_value
      if (Array.isArray(pts) && pts.length > 0) {
        const minWl = Math.min(...pts.map((p) => p.wavelength))
        const maxWl = Math.max(...pts.map((p) => p.wavelength))
        const step = Math.max(1, (maxWl - minWl) / 100)
        const filled: ReflectivityPoint[] = []
        for (let w = minWl; w <= maxWl; w += step) {
          const prev = pts.filter((p) => p.wavelength <= w).pop()
          const next = pts.find((p) => p.wavelength >= w)
          let r = prev?.reflectivity ?? next?.reflectivity ?? 0
          if (prev && next && prev.wavelength !== next.wavelength) {
            const t = (w - prev.wavelength) / (next.wavelength - prev.wavelength)
            r = prev.reflectivity + t * (next.reflectivity - prev.reflectivity)
          }
          filled.push({ wavelength: Math.round(w * 10) / 10, reflectivity: r })
        }
        setSpectralData(filled)
        return
      }
      if (typeof cv === 'number') {
        const filled: ReflectivityPoint[] = []
        for (let w = 350; w <= 1100; w += 5) {
          filled.push({ wavelength: w, reflectivity: cv })
        }
        setSpectralData(filled)
        return
      }
      const curve = await fetchReflectivityCurve(coating.name, 350, 1100, 5)
      setSpectralData(curve)
    },
    []
  )

  useEffect(() => {
    if (selectedCoating) {
      loadSpectralCurve(selectedCoating)
    } else {
      setSpectralData([])
    }
  }, [selectedCoating, loadSpectralCurve])

  const filteredLibrary = search.trim()
    ? library.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.description.toLowerCase().includes(search.toLowerCase()) ||
          c.category.toLowerCase().includes(search.toLowerCase())
      )
    : library

  const grouped = groupByCategory(filteredLibrary)

  const handleCreateConstant = () => {
    setWizardMode('constant')
    setWizardStep('constant')
    setConstantValue(0.005)
  }

  const handleCreateTable = () => {
    setWizardMode('table')
    setWizardStep('table')
    setTablePaste('')
    setTablePoints([])
  }

  const handleTablePasteChange = (v: string) => {
    setTablePaste(v)
    const pts = parseCsvToDataPoints(v)
    setTablePoints(pts)
  }

  const handleCreateSubmit = async () => {
    setCreateError(null)
    if (!customName.trim()) {
      setCreateError('Name is required')
      return
    }
    setIsCreating(true)
    try {
      const payload: CustomCoatingCreate = {
        name: customName.trim(),
        category: 'Custom',
        description: customDesc.trim(),
        is_hr: false,
        data_type: wizardMode === 'constant' ? 'constant' : 'table',
      }
      if (wizardMode === 'constant') {
        payload.constant_value = Math.max(0, Math.min(1, constantValue))
      } else {
        if (tablePoints.length < 2) {
          setCreateError('At least 2 data points required for table')
          return
        }
        payload.data_points = tablePoints
      }
      await createCustomCoating(payload)
      await loadLibrary()
      const created: CoatingLibraryItem = {
        name: customName.trim(),
        description: customDesc.trim(),
        is_hr: false,
        category: 'Custom',
        source: 'custom',
      }
      setSelectedCoating(created)
      if (wizardMode === 'constant') {
        loadSpectralCurve({ name: customName, constant_value: payload.constant_value })
      } else {
        loadSpectralCurve({ name: customName, data_points: tablePoints })
      }
      setWizardOpen(false)
      setWizardStep('type')
      setCustomName('')
      setCustomDesc('')
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create coating')
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold text-cyan-400 flex items-center gap-2">
          <Beaker className="w-7 h-7" />
          Coating Lab
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="coating-browse-catalog"
            onClick={() => setCatalogOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800/80 backdrop-blur-md border border-white/10 text-slate-200 hover:border-cyan-400/40 hover:bg-slate-800 transition-colors"
          >
            <Search className="w-4 h-4" />
            Browse Catalog
          </button>
          <button
            type="button"
            onClick={() => {
              setWizardOpen(true)
              setWizardStep('type')
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500/20 backdrop-blur-md border border-cyan-400/50 text-cyan-400 hover:bg-cyan-500/30 transition-colors shadow-[0_0_12px_rgba(34,211,238,0.15)]"
          >
            <Plus className="w-4 h-4" />
            New Custom Coating
          </button>
        </div>
      </div>

      {/* Spectral Performance Graph */}
      <div data-testid="spectral-performance-graph" className="rounded-xl border border-white/10 bg-slate-900/80 backdrop-blur-md p-6 shadow-xl">
        <h3 className="text-lg font-medium text-slate-200 mb-4 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-cyan-400" />
          Spectral Performance R(λ)
        </h3>
        {spectralData.length > 0 ? (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={spectralData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="spectralGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="wavelength"
                  type="number"
                  domain={[350, 1100]}
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  stroke="#64748b"
                />
                <YAxis
                  domain={[0, 1]}
                  tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  stroke="#64748b"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                  }}
                  labelStyle={{ color: '#e2e8f0' }}
                  formatter={(value: number | undefined) => [`${((value ?? 0) * 100).toFixed(2)}%`, 'R']}
                  labelFormatter={(w) => `λ = ${w} nm`}
                />
                <Area
                  type="monotone"
                  dataKey="reflectivity"
                  stroke="#22d3ee"
                  strokeWidth={2}
                  fill="url(#spectralGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-72 flex items-center justify-center text-slate-500 border border-dashed border-slate-600 rounded-lg">
            Select a coating from the catalog or create a custom one to view R(λ)
          </div>
        )}
        {selectedCoating && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm text-slate-400">Showing:</span>
            <span
              className={`px-3 py-1 rounded-lg text-sm font-medium ${
                selectedCoating.source === 'custom'
                  ? 'bg-cyan-500/20 border border-cyan-400/50 text-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.2)]'
                  : 'bg-slate-800 border border-white/10 text-slate-200'
              }`}
            >
              {selectedCoating.name}
            </span>
            <button
              type="button"
              onClick={() => setSelectedCoating(null)}
              className="text-slate-500 hover:text-slate-300 text-sm"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Catalog Modal */}
      <AnimatePresence>
        {catalogOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4"
            onClick={() => setCatalogOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-2xl max-h-[85vh] rounded-xl border border-white/10 bg-slate-900/95 backdrop-blur-xl shadow-2xl overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-slate-700 px-6 py-4">
                <h3 className="text-xl font-semibold text-cyan-400">Coating Catalog</h3>
                <button
                  type="button"
                  onClick={() => setCatalogOpen(false)}
                  className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/5"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-4 border-b border-slate-700">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Search coatings..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-slate-800/80 border border-white/10 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/30"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-auto p-4 space-y-6">
                {CATEGORY_ORDER.filter((cat) => grouped.has(cat)).map((cat) => (
                  <div key={cat}>
                    <h4 className="text-sm font-medium text-slate-400 mb-2 uppercase tracking-wider">{cat}</h4>
                    <div className="flex flex-wrap gap-2">
                      {grouped.get(cat)!.map((c) => (
                        <button
                          key={c.name}
                          type="button"
                          data-testid={`coating-catalog-${c.name.replace(/\s+/g, '-')}`}
                          onClick={() => {
                            setSelectedCoating(c)
                            setCatalogOpen(false)
                          }}
                          className={`px-4 py-2.5 rounded-lg text-left transition-all flex items-center gap-2 ${
                            selectedCoating?.name === c.name
                              ? 'bg-cyan-500/20 border-2 border-cyan-400/60 text-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.25)]'
                              : 'bg-slate-800/80 border border-white/10 text-slate-200 hover:border-cyan-400/30 hover:bg-slate-800'
                          }`}
                        >
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                              c.is_hr ? 'bg-amber-500/30 text-amber-400' : 'bg-cyan-500/20 text-cyan-400'
                            }`}
                          >
                            {c.is_hr ? 'HR' : 'AR'}
                          </span>
                          <span className="font-medium">{c.name}</span>
                          {c.source === 'custom' && (
                            <span className="text-[10px] text-slate-500">custom</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* New Custom Coating Wizard */}
      <AnimatePresence>
        {wizardOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4"
            onClick={() => !isCreating && setWizardOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-lg rounded-xl border border-white/10 bg-slate-900/95 backdrop-blur-xl shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-slate-700 px-6 py-4">
                <h3 className="text-xl font-semibold text-cyan-400">New Custom Coating</h3>
                <button
                  type="button"
                  onClick={() => !isCreating && setWizardOpen(false)}
                  className="p-2 rounded-lg text-slate-400 hover:text-slate-200"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-6">
                {wizardStep === 'type' && (
                  <div className="space-y-4">
                    <p className="text-slate-400 text-sm">Choose how to define reflectivity:</p>
                    <button
                      type="button"
                      onClick={handleCreateConstant}
                      className="w-full flex items-center justify-between p-4 rounded-lg bg-slate-800/80 border border-white/10 hover:border-cyan-400/40 transition-colors text-left"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-cyan-500/20">
                          <FileText className="w-5 h-5 text-cyan-400" />
                        </div>
                        <div>
                          <div className="font-medium text-slate-200">Constant Reflectivity</div>
                          <div className="text-sm text-slate-500">Same R at all wavelengths (e.g. 0.5%)</div>
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-slate-500" />
                    </button>
                    <button
                      type="button"
                      onClick={handleCreateTable}
                      className="w-full flex items-center justify-between p-4 rounded-lg bg-slate-800/80 border border-white/10 hover:border-cyan-400/40 transition-colors text-left"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-cyan-500/20">
                          <Upload className="w-5 h-5 text-cyan-400" />
                        </div>
                        <div>
                          <div className="font-medium text-slate-200">Table Upload</div>
                          <div className="text-sm text-slate-500">Paste or upload CSV: wavelength_nm, reflectivity</div>
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-slate-500" />
                    </button>
                  </div>
                )}

                {wizardStep === 'constant' && (
                  <div className="space-y-4">
                    <label className="block text-sm font-medium text-slate-300">
                      Reflectivity (0–100%)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.01}
                      value={constantValue * 100}
                      onChange={(e) => setConstantValue(Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100)}
                      className="w-full px-4 py-2.5 rounded-lg bg-slate-800 border border-white/10 text-slate-200 focus:border-cyan-400/50"
                    />
                    <p className="text-slate-500 text-sm">
                      R = {(constantValue * 100).toFixed(2)}% at all wavelengths
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setWizardStep('type')}
                        className="px-4 py-2 rounded-lg text-slate-400 hover:bg-white/5"
                      >
                        Back
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setWizardStep('name')
                          setCustomName('')
                          setCustomDesc('')
                        }}
                        className="px-4 py-2 rounded-lg bg-cyan-500/20 text-cyan-400 border border-cyan-400/50 hover:bg-cyan-500/30"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}

                {wizardStep === 'table' && (
                  <div className="space-y-4">
                    <label className="block text-sm font-medium text-slate-300">
                      Paste CSV (wavelength_nm, reflectivity)
                    </label>
                    <textarea
                      value={tablePaste}
                      onChange={(e) => handleTablePasteChange(e.target.value)}
                      placeholder="wavelength_nm,reflectivity&#10;400,0.02&#10;550,0.01&#10;700,0.03"
                      rows={8}
                      className="w-full px-4 py-2.5 rounded-lg bg-slate-800 border border-white/10 text-slate-200 font-mono text-sm placeholder-slate-500 focus:border-cyan-400/50 resize-none"
                    />
                    <input
                      type="file"
                      accept=".csv,.txt"
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) {
                          const r = new FileReader()
                          r.onload = () => handleTablePasteChange(String(r.result))
                          r.readAsText(f)
                        }
                        e.target.value = ''
                      }}
                      className="hidden"
                      id="csv-upload"
                    />
                    <label
                      htmlFor="csv-upload"
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 border border-white/10 text-slate-300 hover:bg-slate-700 cursor-pointer text-sm"
                    >
                      <Upload className="w-4 h-4" />
                      Upload CSV
                    </label>
                    {tablePoints.length > 0 && (
                      <p className="text-cyan-400 text-sm">{tablePoints.length} points loaded</p>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setWizardStep('type')}
                        className="px-4 py-2 rounded-lg text-slate-400 hover:bg-white/5"
                      >
                        Back
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setWizardStep('name')
                          setCustomName('')
                          setCustomDesc('')
                        }}
                        disabled={tablePoints.length < 2}
                        className="px-4 py-2 rounded-lg bg-cyan-500/20 text-cyan-400 border border-cyan-400/50 hover:bg-cyan-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}

                {wizardStep === 'name' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">Name</label>
                      <input
                        type="text"
                        value={customName}
                        onChange={(e) => setCustomName(e.target.value)}
                        placeholder="My Custom Coating"
                        className="w-full px-4 py-2.5 rounded-lg bg-slate-800 border border-white/10 text-slate-200 placeholder-slate-500 focus:border-cyan-400/50"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">Description (optional)</label>
                      <input
                        type="text"
                        value={customDesc}
                        onChange={(e) => setCustomDesc(e.target.value)}
                        placeholder="e.g. Optimized for 532 nm"
                        className="w-full px-4 py-2.5 rounded-lg bg-slate-800 border border-white/10 text-slate-200 placeholder-slate-500 focus:border-cyan-400/50"
                      />
                    </div>
                    {createError && (
                      <p className="text-red-400 text-sm">{createError}</p>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setWizardStep(wizardMode)}
                        className="px-4 py-2 rounded-lg text-slate-400 hover:bg-white/5"
                      >
                        Back
                      </button>
                      <button
                        type="button"
                        onClick={handleCreateSubmit}
                        disabled={isCreating || !customName.trim()}
                        className="px-4 py-2 rounded-lg bg-cyan-500/20 text-cyan-400 border border-cyan-400/50 hover:bg-cyan-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isCreating ? 'Creating…' : 'Create Coating'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
