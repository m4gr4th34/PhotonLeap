/**
 * Neural Link: postMessage bridge between React and Pyodide worker.
 * Sends lens data, receives ray-trace results without network calls.
 */

import type { TraceResponse } from '../api/trace'
import type { ChromaticShiftPoint } from '../api/chromatic'
import type { Surface } from '../types/system'
import { config } from '../config'

type TracePayload = {
  surfaces: Array<Record<string, unknown>>
  entrancePupilDiameter: number
  wavelengths: number[]
  fieldAngles: number[]
  numRays: number
  focusMode?: string
  m2Factor?: number
}

let worker: Worker | null = null
let initPromise: Promise<void> | null = null

function getWorkerUrl(): string {
  // Use Vite BASE_URL for correct resolution on GitHub Pages (base: '/repo-name/').
  // Resolve relative to location.href for reliable Worker loading when serving dist/.
  const base = (typeof import.meta !== 'undefined' && (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) || '/'
  const baseNorm = base.endsWith('/') ? base : `${base}/`
  const path = `${baseNorm}pyodide/worker.js`
  return typeof location !== 'undefined'
    ? new URL(path, location.href).href
    : (path.startsWith('http') ? path : (typeof document !== 'undefined' ? new URL(path, document.baseURI).href : path))
}

async function ensureWorker(): Promise<Worker> {
  if (worker) return worker
  if (initPromise) {
    await initPromise
    return worker!
  }
  initPromise = (async () => {
    worker = new Worker(getWorkerUrl(), { type: 'classic' })
    worker.addEventListener('message', (e: MessageEvent) => {
      if (e.data?.type === 'log') {
        ;(e.data.lines as string[] || []).forEach((line) =>
          console.log('%c[Python]', 'color: #4CAF50', line)
        )
      }
    })
    await new Promise<void>((resolve, reject) => {
      const onMsg = (e: MessageEvent) => {
        if (e.data?.type === 'ready') {
          worker!.removeEventListener('message', onMsg)
          worker!.removeEventListener('error', onErr)
          if (e.data.error) reject(new Error(e.data.error))
          else resolve()
        }
      }
      const onErr = (err: ErrorEvent) => {
        worker!.removeEventListener('message', onMsg)
        worker!.removeEventListener('error', onErr)
        reject(err)
      }
      worker!.addEventListener('message', onMsg)
      worker!.addEventListener('error', onErr)
      worker!.postMessage({ type: 'init' })
    })
  })()
  await initPromise
  return worker!
}

export async function traceViaPyodide(optical_stack: {
  surfaces: Surface[]
  entrancePupilDiameter: number
  wavelengths: number[]
  fieldAngles: number[]
  numRays: number
  focusMode?: string
  m2Factor?: number
}): Promise<TraceResponse> {
  const w = await ensureWorker()
  const payload: TracePayload = {
    surfaces: optical_stack.surfaces.map((s) => ({
      id: s.id,
      type: s.type,
      radius: s.radius,
      thickness: s.thickness,
      refractiveIndex: s.refractiveIndex,
      diameter: s.diameter,
      material: s.material,
      description: s.description,
      coating: s.coating,
      sellmeierCoefficients: s.sellmeierCoefficients,
      coatingDataPoints: s.coatingDataPoints,
      coatingConstantValue: s.coatingConstantValue,
      coatingIsHr: s.coatingIsHr,
    })),
    entrancePupilDiameter: optical_stack.entrancePupilDiameter,
    wavelengths: optical_stack.wavelengths,
    fieldAngles: (optical_stack.fieldAngles ?? [0]).slice(0, config.maxFieldAngles),
    numRays: optical_stack.numRays,
    focusMode: optical_stack.focusMode ?? 'On-Axis',
    m2Factor: optical_stack.m2Factor ?? 1.0,
  }
  const id = `trace-${Date.now()}-${Math.random().toString(36).slice(2)}`
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'trace' && e.data.id === id) {
        w.removeEventListener('message', onMsg)
        if (e.data.error) {
          reject(new Error(e.data.error))
        } else {
          resolve(e.data.result as TraceResponse)
        }
      }
    }
    w.addEventListener('message', onMsg)
    w.postMessage({ type: 'trace', id, payload })
  })
}

export async function chromaticShiftViaPyodide(optical_stack: {
  surfaces: Surface[]
  entrancePupilDiameter: number
  wavelengths: number[]
  fieldAngles: number[]
  numRays: number
  focusMode?: string
  m2Factor?: number
  wavelength_min_nm?: number
  wavelength_max_nm?: number
  wavelength_step_nm?: number
}): Promise<ChromaticShiftPoint[]> {
  const w = await ensureWorker()
  const payload = {
    surfaces: optical_stack.surfaces.map((s) => ({
      id: s.id,
      type: s.type,
      radius: s.radius,
      thickness: s.thickness,
      refractiveIndex: s.refractiveIndex,
      diameter: s.diameter,
      material: s.material,
      description: s.description,
      sellmeierCoefficients: s.sellmeierCoefficients,
    })),
    entrancePupilDiameter: optical_stack.entrancePupilDiameter,
    wavelengths: optical_stack.wavelengths,
    fieldAngles: (optical_stack.fieldAngles ?? [0]).slice(0, config.maxFieldAngles),
    numRays: optical_stack.numRays,
    focusMode: optical_stack.focusMode ?? 'On-Axis',
    m2Factor: optical_stack.m2Factor ?? 1.0,
    wavelength_min_nm: optical_stack.wavelength_min_nm ?? 400,
    wavelength_max_nm: optical_stack.wavelength_max_nm ?? 1100,
    wavelength_step_nm: optical_stack.wavelength_step_nm ?? 10,
  }
  const id = `chromatic-${Date.now()}-${Math.random().toString(36).slice(2)}`
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'chromatic-shift' && e.data.id === id) {
        w.removeEventListener('message', onMsg)
        if (e.data.error) {
          reject(new Error(e.data.error))
        } else {
          resolve((e.data.result ?? []) as ChromaticShiftPoint[])
        }
      }
    }
    w.addEventListener('message', onMsg)
    w.postMessage({ type: 'chromatic-shift', id, payload })
  })
}

export async function optimizeColorsViaPyodide(optical_stack: {
  surfaces: Surface[]
  entrancePupilDiameter: number
  wavelengths: number[]
  fieldAngles: number[]
  numRays: number
  focusMode?: string
  m2Factor?: number
}): Promise<{ recommended_glass: string; estimated_lca_reduction: number }> {
  const w = await ensureWorker()
  const payload = {
    surfaces: optical_stack.surfaces.map((s) => ({
      id: s.id,
      type: s.type,
      radius: s.radius,
      thickness: s.thickness,
      refractiveIndex: s.refractiveIndex,
      diameter: s.diameter,
      material: s.material,
      description: s.description,
      sellmeierCoefficients: s.sellmeierCoefficients,
    })),
    entrancePupilDiameter: optical_stack.entrancePupilDiameter,
    wavelengths: optical_stack.wavelengths,
    fieldAngles: (optical_stack.fieldAngles ?? [0]).slice(0, config.maxFieldAngles),
    numRays: optical_stack.numRays,
    focusMode: optical_stack.focusMode ?? 'On-Axis',
    m2Factor: optical_stack.m2Factor ?? 1.0,
  }
  const id = `optimize-${Date.now()}-${Math.random().toString(36).slice(2)}`
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'optimize-colors' && e.data.id === id) {
        w.removeEventListener('message', onMsg)
        if (e.data.error) {
          reject(new Error(e.data.error))
        } else {
          resolve((e.data.result ?? { recommended_glass: '', estimated_lca_reduction: 0 }) as { recommended_glass: string; estimated_lca_reduction: number })
        }
      }
    }
    w.addEventListener('message', onMsg)
    w.postMessage({ type: 'optimize-colors', id, payload })
  })
}

export function isPyodideEnabled(): boolean {
  return typeof import.meta.env.VITE_USE_PYODIDE !== 'undefined' &&
    import.meta.env.VITE_USE_PYODIDE === 'true'
}

/** Resolves when the Pyodide worker is ready. Resolves immediately if Pyodide is disabled. */
export function waitForPyodideReady(): Promise<void> {
  if (!isPyodideEnabled()) return Promise.resolve()
  return ensureWorker().then(() => {})
}

/**
 * Execute any Python kernel function by name via Pyodide.
 * Enables agent to invoke run_trace, run_chromatic_shift, run_optimize_colors or future kernels.
 * @param fn - Python function name (e.g. 'run_trace', 'run_chromatic_shift')
 * @param payload - Argument passed to the function (e.g. optical_stack for run_trace)
 */
export async function executeViaPyodide<T = unknown>(fn: string, payload: unknown): Promise<T> {
  if (!isPyodideEnabled()) {
    throw new Error('executeViaPyodide requires VITE_USE_PYODIDE=true')
  }
  const w = await ensureWorker()
  const id = `execute-${Date.now()}-${Math.random().toString(36).slice(2)}`
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'execute' && e.data.id === id) {
        w.removeEventListener('message', onMsg)
        if (e.data.error) {
          reject(new Error(e.data.error))
        } else {
          resolve(e.data.result as T)
        }
      }
    }
    w.addEventListener('message', onMsg)
    w.postMessage({ type: 'execute', id, fn, payload })
  })
}
