/**
 * Neural Link: postMessage bridge between React and Pyodide worker.
 * Sends lens data, receives ray-trace results without network calls.
 */

import type { TraceResponse } from '../api/trace'
import type { Surface } from '../types/system'

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
  // document.baseURI parsing can fail when URL has no trailing slash.
  const base = (typeof import.meta !== 'undefined' && (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) || '/'
  const baseNorm = base.endsWith('/') ? base : `${base}/`
  const path = `${baseNorm}pyodide/worker.js`
  if (typeof document !== 'undefined' && document.baseURI) {
    return new URL(path, document.baseURI).href
  }
  return path.startsWith('http') ? path : (typeof location !== 'undefined' ? new URL(path, location.href).href : path)
}

async function ensureWorker(): Promise<Worker> {
  if (worker) return worker
  if (initPromise) {
    await initPromise
    return worker!
  }
  initPromise = (async () => {
    worker = new Worker(getWorkerUrl(), { type: 'classic' })
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
    fieldAngles: optical_stack.fieldAngles,
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

export function isPyodideEnabled(): boolean {
  return typeof import.meta.env.VITE_USE_PYODIDE !== 'undefined' &&
    import.meta.env.VITE_USE_PYODIDE === 'true'
}

/** Resolves when the Pyodide worker is ready. Resolves immediately if Pyodide is disabled. */
export function waitForPyodideReady(): Promise<void> {
  if (!isPyodideEnabled()) return Promise.resolve()
  return ensureWorker().then(() => {})
}
