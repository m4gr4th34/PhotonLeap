import { motion } from 'framer-motion'
import { Plus, Trash2, Magnet } from 'lucide-react'
import type { SystemState } from '../types/system'
import { config, isMac } from '../config'
import { computeThermalLensing } from '../lib/thermal_lensing'

type SystemPropertiesProps = {
  systemState: SystemState
  onSystemStateChange: (state: SystemState | ((prev: SystemState) => SystemState)) => void
  selectedSurfaceId: string | null
  onSelectSurface: (id: string | null) => void
  showBestFocus: boolean
  onShowBestFocusChange: (value: boolean) => void
  snapToFocus: boolean
  onSnapToFocusChange: (value: boolean) => void
  snapToSurface: boolean
  onSnapToSurfaceChange: (value: boolean) => void
}

const inputClass =
  'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-electric/50'

export function SystemProperties({
  systemState,
  onSystemStateChange,
  selectedSurfaceId,
  onSelectSurface,
  showBestFocus,
  onShowBestFocusChange,
  snapToFocus,
  onSnapToFocusChange,
  snapToSurface,
  onSnapToSurfaceChange,
}: SystemPropertiesProps) {
  const update = (partial: Partial<SystemState>) => {
    onSystemStateChange((prev) => ({ ...prev, ...partial }))
  }

  const addWavelength = () => {
    onSystemStateChange((prev) => ({
      ...prev,
      wavelengths: [...prev.wavelengths, config.defaults.defaultWavelength],
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
      fieldAngles: [...prev.fieldAngles, config.defaults.defaultFieldAngle],
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
            min={config.rayCount.min}
            max={config.rayCount.max}
              value={systemState.numRays}
              onChange={(e) => update({ numRays: Number(e.target.value) })}
              className="flex-1 accent-cyan-electric"
            />
            <span className="text-cyan-electric text-sm font-mono w-6">
              {systemState.numRays}
            </span>
          </div>
        </section>

        {/* Focus Configuration */}
        <section className="glass-card p-4">
          <h3 className="text-sm font-medium text-slate-300 mb-3">Focus Configuration</h3>
          <div className="flex rounded-lg overflow-hidden border border-white/10 bg-white/5">
            <button
              type="button"
              onClick={() => update({ focusMode: 'On-Axis' })}
              className={`flex-1 px-3 py-2.5 text-sm font-medium transition-colors ${
                (systemState.focusMode ?? 'On-Axis') === 'On-Axis'
                  ? 'bg-cyan-electric/20 text-cyan-electric border-r border-white/10'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
            >
              Paraxial (On-Axis)
            </button>
            <button
              type="button"
              onClick={() => update({ focusMode: 'Balanced' })}
              className={`flex-1 px-3 py-2.5 text-sm font-medium transition-colors ${
                (systemState.focusMode ?? 'On-Axis') === 'Balanced'
                  ? 'bg-amber-500/20 text-amber-400 border-l border-white/10'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
            >
              Best Composite
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {(systemState.focusMode ?? 'On-Axis') === 'Balanced'
              ? 'Circle of Least Confusion across the entire field of view.'
              : 'Ignores off-axis aberrations when placing the focus diamond.'}
          </p>
        </section>

        {/* Snapping & Precision */}
        <section className="glass-card p-4">
          <h3 className="text-sm font-medium text-slate-300 mb-3 flex items-center gap-2">
            <Magnet className="w-4 h-4 text-cyan-electric" strokeWidth={2} />
            Snapping & Precision
          </h3>
          <div className="space-y-3">
            <label className="flex items-center justify-between gap-3 cursor-pointer group">
              <span className="text-sm text-slate-300 group-hover:text-slate-200 transition-colors">
                Snap to Focus
              </span>
              <span
                role="switch"
                aria-checked={snapToFocus}
                tabIndex={0}
                onClick={() => onSnapToFocusChange(!snapToFocus)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSnapToFocusChange(!snapToFocus)
                  }
                }}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out hover:opacity-90 ${
                  snapToFocus ? 'bg-cyan-electric/40' : 'bg-white/10'
                }`}
              >
                <span
                  className={`pointer-events-none absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-lg transition-all duration-200 ease-in-out ${
                    snapToFocus ? 'left-5 bg-cyan-electric' : 'left-0.5'
                  }`}
                />
              </span>
            </label>
            <label className="flex items-center justify-between gap-3 cursor-pointer group">
              <span className="text-sm text-slate-300 group-hover:text-slate-200 transition-colors">
                Snap to Surface
              </span>
              <span
                role="switch"
                aria-checked={snapToSurface}
                tabIndex={0}
                onClick={() => onSnapToSurfaceChange(!snapToSurface)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSnapToSurfaceChange(!snapToSurface)
                  }
                }}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out hover:opacity-90 ${
                  snapToSurface ? 'bg-cyan-electric/40' : 'bg-white/10'
                }`}
              >
                <span
                  className={`pointer-events-none absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-lg transition-all duration-200 ease-in-out ${
                    snapToSurface ? 'left-5 bg-cyan-electric' : 'left-0.5'
                  }`}
                />
              </span>
            </label>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Snap to Focus: Gold Diamond. Snap to Surface: lens vertices. Hold{' '}
            <kbd className="px-1.5 py-0.5 rounded bg-slate-800/90 text-slate-200 font-mono text-[10px] shadow-[0_1px_0_0_rgba(255,255,255,0.1),inset_0_-1px_0_0_rgba(0,0,0,0.3)]">
              {isMac ? '⌥ Option' : 'Alt'}
            </kbd>{' '}
            to disable snapping.
          </p>
        </section>

        {/* Visualization Settings */}
        <section className="glass-card p-4">
          <h3 className="text-sm font-medium text-slate-300 mb-3">Visualization Settings</h3>
          <label className="flex items-center justify-between gap-3 cursor-pointer group">
            <span className="text-sm text-slate-300 group-hover:text-slate-200 transition-colors">
              Show Best Focus Diamond
            </span>
            <span
              role="switch"
              aria-checked={showBestFocus}
              tabIndex={0}
              onClick={() => onShowBestFocusChange(!showBestFocus)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onShowBestFocusChange(!showBestFocus)
                }
              }}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out hover:opacity-90 ${
                showBestFocus ? 'bg-cyan-electric/40' : 'bg-white/10'
              }`}
            >
              <span
                className={`pointer-events-none absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-lg transition-all duration-200 ease-in-out ${
                  showBestFocus ? 'left-5 bg-cyan-electric' : 'left-0.5'
                }`}
              />
            </span>
          </label>
        </section>

        {/* Thermal Lensing (high-power CW lasers) */}
        <section className="glass-card p-4 border-orange-500/20">
          <h3 className="text-sm font-medium text-slate-300 mb-3">Thermal Lensing</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Laser Power (W)</label>
              <input
                type="number"
                min={0}
                max={10000}
                step={1}
                value={systemState.laserPowerW ?? ''}
                onChange={(e) =>
                  onSystemStateChange((prev) => ({
                    ...prev,
                    laserPowerW: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value) || 0),
                  }))
                }
                placeholder="0"
                className={inputClass}
              />
              <p className="text-xs text-slate-500 mt-1">
                CW power for thermo-optic (dn/dT) analysis. Absorption α set per lens in System Editor.
              </p>
            </div>
            {(() => {
              const coldEfl =
                systemState.traceResult?.performance?.fNumber != null && systemState.entrancePupilDiameter > 0
                  ? systemState.traceResult.performance.fNumber * systemState.entrancePupilDiameter
                  : (() => {
                      const s0 = systemState.surfaces[0]
                      const s1 = systemState.surfaces[1]
                      return s0 && s1 && s0.radius !== 0 && s1.radius !== 0
                        ? 1 / ((s0.refractiveIndex - 1) * (1 / s0.radius - 1 / -s1.radius))
                        : 100
                    })()
              const thermal = computeThermalLensing(systemState, coldEfl)
              return thermal.hasSignificantHeating ? (
                <div className="text-xs space-y-1 pt-1 border-t border-white/10">
                  <div className="flex justify-between text-slate-400">
                    <span>Cold EFL</span>
                    <span className="tabular-nums text-slate-300">{thermal.eflCold.toFixed(2)} mm</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Effective EFL (heated)</span>
                    <span className="tabular-nums text-orange-400">{thermal.eflEffective.toFixed(2)} mm</span>
                  </div>
                  <div className="flex justify-between text-orange-400 font-medium">
                    <span>Δf (thermo-optic)</span>
                    <span className="tabular-nums">{thermal.deltaEfl.toFixed(3)} mm</span>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>P absorbed</span>
                    <span className="tabular-nums">{(thermal.pAbsorbed * 1000).toFixed(2)} mW</span>
                  </div>
                </div>
              ) : null
            })()}
          </div>
        </section>

        {/* Physical Optics / Gaussian Beam */}
        <section className="glass-card p-4">
          <h3 className="text-sm font-medium text-slate-300 mb-3">Physical Optics</h3>
          <div className="space-y-2">
            <label className="block text-sm text-slate-400">Laser M² Factor</label>
            <input
              type="number"
              min={0.1}
              max={10}
              step={0.1}
              value={systemState.m2Factor ?? 1.0}
              onChange={(e) =>
                onSystemStateChange((prev) => ({
                  ...prev,
                  m2Factor: Math.max(0.1, Math.min(10, Number(e.target.value) || 1)),
                }))
              }
              className={inputClass}
            />
            <p className="text-xs text-slate-500">
              M² = 1.0 for perfect Gaussian. Higher values show how beam quality affects focus.
            </p>
          </div>
        </section>

        {/* Ultrafast / Dispersion */}
        <section className="glass-card p-4">
          <h3 className="text-sm font-medium text-slate-300 mb-3">Ultrafast Pulse</h3>
          <div className="space-y-2">
            <label className="block text-sm text-slate-400">Pulse Width (fs)</label>
            <input
              type="number"
              min={5}
              max={10000}
              step={10}
              value={systemState.pulseWidthFs ?? 100}
              onChange={(e) =>
                onSystemStateChange((prev) => ({
                  ...prev,
                  pulseWidthFs: Math.max(5, Math.min(10000, Number(e.target.value) || 100)),
                }))
              }
              className={inputClass}
              placeholder="100"
            />
            <p className="text-xs text-slate-500">
              Input pulse width for dispersion analysis. Sellmeier equation used for glass.
            </p>
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
              <motion.div
                key={s.id}
                layout
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                onClick={() => onSelectSurface(s.id)}
                className={`flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 border transition-colors ${
                  selectedSurfaceId === s.id
                    ? 'bg-cyan-electric/20 border-cyan-electric/50 ring-1 ring-cyan-electric/50'
                    : 'bg-white/5 border-white/10 hover:bg-white/10'
                }`}
              >
                <span className="text-sm">
                  {s.material ?? s.type} R={s.radius}
                </span>
                <span className="text-cyan-electric text-xs">t={s.thickness}</span>
              </motion.div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
