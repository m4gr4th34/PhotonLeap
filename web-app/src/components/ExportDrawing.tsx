import { useState, useCallback } from 'react'
import { FileDown, Printer } from 'lucide-react'
import type { SystemState } from '../types/system'
import { generateIso10110Svg } from '../lib/iso10110_blueprint'
import { toLensX, type CustomCoatingData } from '../lib/lensX'
import { fetchCoatingDefinition } from '../api/coatings'

type ExportDrawingProps = {
  systemState: SystemState
  onSystemStateChange: (state: SystemState | ((prev: SystemState) => SystemState)) => void
}

const inputClass =
  'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-electric/50'

export function ExportDrawing({
  systemState,
  onSystemStateChange,
}: ExportDrawingProps) {
  const [projectName, setProjectName] = useState(systemState.projectName ?? 'My Optical Design')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [drawnBy, setDrawnBy] = useState('MacOptics')

  const handleExportSvg = useCallback(() => {
    const svg = generateIso10110Svg(systemState, {
      projectName: projectName || 'Untitled',
      date,
      drawnBy,
      width: 1400,
      height: 1000,
    })
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `optical-drawing-${date}.svg`
    a.click()
    URL.revokeObjectURL(url)
  }, [systemState, projectName, date, drawnBy])

  const handleExportLensX = useCallback(async () => {
    const surfaces = systemState.surfaces
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
    const lensX = toLensX(surfaces, {
      projectName: projectName || 'Untitled',
      date,
      drawnBy,
      entrancePupilDiameter: systemState.entrancePupilDiameter ?? 10,
      customCoatingData,
    })
    const blob = new Blob([JSON.stringify(lensX, null, 2)], {
      type: 'application/json;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `lens-x-${projectName.replace(/\s+/g, '-')}-${date}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [systemState, projectName, date, drawnBy])

  const handlePrintPdf = useCallback(() => {
    const svg = generateIso10110Svg(systemState, {
      projectName: projectName || 'Untitled',
      date,
      drawnBy,
      width: 1122,
      height: 794,
    })
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const win = window.open(url, '_blank', 'width=1200,height=850')
    if (!win) {
      URL.revokeObjectURL(url)
      return
    }
    win.addEventListener('load', () => {
      setTimeout(() => {
        win.print()
        win.onbeforeunload = () => URL.revokeObjectURL(url)
        win.onafterprint = () => win.close()
      }, 300)
    })
  }, [systemState, projectName, date, drawnBy])

  const svgPreview = generateIso10110Svg(systemState, {
    projectName: projectName || 'Untitled',
    date,
    drawnBy,
    width: 800,
    height: 570,
  })
  const svgDataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgPreview)))}`

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <h2 className="text-cyan-electric font-semibold text-lg">ISO 10110 Export</h2>

      <section className="glass-card p-4">
        <h3 className="text-sm font-medium text-slate-300 mb-3">Drawing Details</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Project Name</label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => {
                setProjectName(e.target.value)
                onSystemStateChange((prev) => ({ ...prev, projectName: e.target.value }))
              }}
              placeholder="My Optical Design"
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Drawn By</label>
            <input
              type="text"
              value={drawnBy}
              onChange={(e) => setDrawnBy(e.target.value)}
              placeholder="MacOptics"
              className={inputClass}
            />
          </div>
        </div>
      </section>

      <section className="glass-card p-4 flex-1 min-h-0 flex flex-col">
        <h3 className="text-sm font-medium text-slate-300 mb-3">Preview</h3>
        <div className="flex-1 min-h-[300px] rounded-lg overflow-auto bg-slate-900/50 border border-white/10">
          <img
            src={svgDataUrl}
            alt="ISO 10110 blueprint preview"
            className="w-full h-auto object-contain"
            style={{ minHeight: 300 }}
          />
        </div>
      </section>

      <section className="glass-card p-4">
        <h3 className="text-sm font-medium text-slate-300 mb-3">Export Drawing</h3>
        <p className="text-xs text-slate-500 mb-4">
          Technical blueprint with cross-section, dimensions, data table (S/D, Material, CT), and title block. LENS-X JSON includes radius, thickness, material, coating per surface; flat surfaces export radius as &quot;infinity&quot;.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleExportLensX}
            className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all bg-cyan-electric/20 text-cyan-electric border border-cyan-electric/50 hover:bg-cyan-electric/30"
          >
            <FileDown className="w-4 h-4" />
            Download LENS-X JSON
          </button>
          <button
            type="button"
            onClick={handleExportSvg}
            className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all bg-white/10 text-slate-200 border border-white/20 hover:bg-white/20"
          >
            <FileDown className="w-4 h-4" />
            Download SVG
          </button>
          <button
            type="button"
            onClick={handlePrintPdf}
            className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all bg-white/10 text-slate-200 border border-white/20 hover:bg-white/20"
          >
            <Printer className="w-4 h-4" />
            Print / Save as PDF
          </button>
        </div>
      </section>
    </div>
  )
}
