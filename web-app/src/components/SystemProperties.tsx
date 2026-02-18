import { Plus, Trash2 } from 'lucide-react'
import type { SystemState } from '../types/system'

type SystemPropertiesProps = {
  systemState: SystemState
  onSystemStateChange: (state: SystemState | ((prev: SystemState) => SystemState)) => void
}

const inputClass =
  'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-electric/50'

export function SystemProperties({ systemState, onSystemStateChange }: SystemPropertiesProps) {
  const update = (partial: Partial<SystemState>) => {
    onSystemStateChange((prev) => ({ ...prev, ...partial }))
  }

  const addWavelength = () => {
    onSystemStateChange((prev) => ({
      ...prev,
      wavelengths: [...prev.wavelengths, 587.6],
    }))
  }

  const removeWavelength = (i: number) => {
    onSystemStateChange((prev) => ({
      ...prev,
      wavelengths: prev.wavelengths.filter((_, j) => j !== i),
    }))
  }

  const updateWavelength = (i: number, v: number) => {
    onSystemStateChange((prev) => ({
      ...prev,
      wavelengths: prev.wavelengths.map((w, j) => (j === i ? v : w)),
    }))
  }

  const addFieldAngle = () => {
    onSystemStateChange((prev) => ({
      ...prev,
      fieldAngles: [...prev.fieldAngles, 7],
    }))
  }

  const removeFieldAngle = (i: number) => {
    onSystemStateChange((prev) => ({
      ...prev,
      fieldAngles: prev.fieldAngles.filter((_, j) => j !== i),
    }))
  }

  const updateFieldAngle = (i: number, v: number) => {
    onSystemStateChange((prev) => ({
      ...prev,
      fieldAngles: prev.fieldAngles.map((a, j) => (j === i ? v : a)),
    }))
  }

  return (
    <div className="h-full glass-card rounded-none border-l border-white/10 p-4 overflow-y-auto">
      <h2 className="text-cyan-electric font-semibold text-lg mb-4">System Properties</h2>

      <div className="space-y-4">
        {/* Entrance Pupil Diameter */}
        <section className="glass-card p-4">
          <h3 className="text-sm font-medium text-slate-300 mb-3">
            Entrance Pupil Diameter
          </h3>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={systemState.entrancePupilDiameter}
              onChange={(e) =>
                update({ entrancePupilDiameter: Number(e.target.value) || 0 })
              }
              min={0.1}
              step={0.5}
              className={inputClass}
            />
            <span className="text-slate-500 text-sm">mm</span>
          </div>
        </section>

        {/* Wavelengths */}
        <section className="glass-card p-4">
          <h3 className="text-sm font-medium text-slate-300 mb-3">Wavelengths</h3>
          <div className="space-y-2">
            {systemState.wavelengths.map((w, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="number"
                  value={w}
                  onChange={(e) => updateWavelength(i, Number(e.target.value) || 0)}
                  min={300}
                  max={2000}
                  step={1}
                  className={inputClass}
                />
                <span className="text-slate-500 text-sm w-8">nm</span>
                {systemState.wavelengths.length > 1 && (
                  <button
                    onClick={() => removeWavelength(i)}
                    className="p-1.5 rounded text-slate-500 hover:text-red-400 hover:bg-white/5 transition-colors"
                    aria-label="Remove wavelength"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={addWavelength}
            className="mt-2 w-full flex items-center justify-center gap-1 py-2 rounded-lg border border-dashed border-white/20 text-slate-400 hover:text-cyan-electric hover:border-cyan-electric/50 transition-colors text-sm"
          >
            <Plus className="w-4 h-4" />
            Add wavelength
          </button>
        </section>

        {/* Field Angles */}
        <section className="glass-card p-4">
          <h3 className="text-sm font-medium text-slate-300 mb-3">Field Angles</h3>
          <div className="space-y-2">
            {systemState.fieldAngles.map((a, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="number"
                  value={a}
                  onChange={(e) => updateFieldAngle(i, Number(e.target.value) || 0)}
                  min={0}
                  max={90}
                  step={0.5}
                  className={inputClass}
                />
                <span className="text-slate-500 text-sm w-8">°</span>
                {systemState.fieldAngles.length > 1 && (
                  <button
                    onClick={() => removeFieldAngle(i)}
                    className="p-1.5 rounded text-slate-500 hover:text-red-400 hover:bg-white/5 transition-colors"
                    aria-label="Remove field angle"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={addFieldAngle}
            className="mt-2 w-full flex items-center justify-center gap-1 py-2 rounded-lg border border-dashed border-white/20 text-slate-400 hover:text-cyan-electric hover:border-cyan-electric/50 transition-colors text-sm"
          >
            <Plus className="w-4 h-4" />
            Add field angle
          </button>
        </section>

        {/* Ray Count */}
        <section className="glass-card p-4">
          <h3 className="text-sm font-medium text-slate-300 mb-3">Ray Count</h3>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={3}
              max={21}
              value={systemState.numRays}
              onChange={(e) => update({ numRays: Number(e.target.value) })}
              className="flex-1 accent-cyan-electric"
            />
            <span className="text-cyan-electric text-sm font-mono w-6">
              {systemState.numRays}
            </span>
          </div>
        </section>

        {/* Performance Card */}
        <section className="glass-card p-4 border-cyan-electric/20">
          <h3 className="text-sm font-medium text-cyan-electric mb-3">Performance</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-400">RMS Spot Radius</span>
              <span className="text-slate-200 font-mono">
                {systemState.rmsSpotRadius.toFixed(4)} mm
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Total Length</span>
              <span className="text-slate-200 font-mono">
                {systemState.totalLength.toFixed(2)} mm
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">F-Number</span>
              <span className="text-slate-200 font-mono">
                f/{systemState.fNumber.toFixed(2)}
              </span>
            </div>
          </div>
        </section>

        {/* Surfaces summary */}
        <section className="glass-card p-4">
          <h3 className="text-sm font-medium text-slate-300 mb-3">Surfaces</h3>
          <div className="space-y-2">
            {systemState.surfaces.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 border border-white/10"
              >
                <span className="text-sm">
                  {s.type} R={s.radius > 0 ? s.radius : s.radius}
                </span>
                <span className="text-cyan-electric text-xs">t={s.thickness}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
