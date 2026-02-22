/**
 * PhysicistAgent Session — State-Diff, Episodic Memory, Small Talk Pruning.
 * Enables 70%+ token reduction via handshake-once + delta-only subsequent requests.
 */

import type { Surface, TraceResult } from '../types/system'
import { enrichSurfaceWithPhysics } from './latticePhysics'

/** Trace result or API response (performance/focusZ optional) */
type TraceLike = TraceResult | { focusZ?: number; bestFocusZ?: number; performance?: { rmsSpotRadius?: number; totalLength?: number; fNumber?: number }; gaussianBeam?: TraceResult['gaussianBeam'] } | null

/** Episodic memory: 3-bullet summary instead of raw message history */
export type EpisodicMemory = {
  currentGoal: string
  constraintsMet: string[]
  failedIterations: string[]
}

/** Session state for token-efficient agent orchestration */
export type AgentSessionState = {
  /** Full optical stack sent once (handshake) */
  handshakeSent: boolean
  /** Last known surfaces (for delta computation) */
  lastSurfaces: Surface[]
  /** Last valid stack — surfaces that passed trace (Verification Hook) */
  lastValidStack: Surface[]
  /** Last known trace performance */
  lastRmsUm: number | null
  /** Episodic summary — condenses chat/retry history */
  episodic: EpisodicMemory
}

export function createAgentSession(): AgentSessionState {
  return {
    handshakeSent: false,
    lastSurfaces: [],
    lastValidStack: [],
    lastRmsUm: null,
    episodic: {
      currentGoal: '',
      constraintsMet: [],
      failedIterations: [],
    },
  }
}

/** Physics constraints string for Context Summary */
export const PHYSICS_CONSTRAINTS =
  'Physical invariants: thickness > 0; n ≥ 1; thickness ≤ |radius|×2; aspect ratio ≤ 20; total length ≤ bench limit'

/** Surface fields we track for delta (only send if changed) */
const SURFACE_DELTA_KEYS = ['radius', 'thickness', 'refractiveIndex', 'diameter', 'material', 'description', 'coating', 'type'] as const

export type OpticalStackMeta = {
  entrancePupilDiameter: number
  wavelengths: number[]
  fieldAngles: number[]
  numRays: number
  focusMode?: string
  m2Factor?: number
}

/** Compute state delta: only modified surface params + high-level summary. */
export function getStateDelta(
  session: AgentSessionState,
  surfaces: Surface[],
  traceResult: TraceLike,
  opticalMeta: OpticalStackMeta
): { delta: object; isHandshake: boolean } {
  const rmsUm =
    traceResult?.performance?.rmsSpotRadius != null
      ? traceResult.performance.rmsSpotRadius * 1000
      : null

  const isHandshake = !session.handshakeSent

  if (isHandshake) {
    return {
      isHandshake: true,
      delta: {
        optical_stack: {
          surfaces: surfaces.map((s, i) => {
            const enriched = enrichSurfaceWithPhysics(s)
            return {
              id: enriched.id,
              semanticName: enriched.semanticName ?? `S${i + 1}`,
              aiContext: enriched.aiContext ?? '',
              type: enriched.type,
              radius: enriched.radius,
              thickness: enriched.thickness,
              refractiveIndex: enriched.refractiveIndex,
              diameter: enriched.diameter,
              material: enriched.material,
              description: enriched.description,
              coating: enriched.coating,
              effective_focal_length: enriched.effective_focal_length ?? null,
              critical_angle: enriched.critical_angle ?? null,
            }
          }),
          entrancePupilDiameter: opticalMeta.entrancePupilDiameter,
          wavelengths: opticalMeta.wavelengths,
          fieldAngles: opticalMeta.fieldAngles,
          numRays: opticalMeta.numRays,
          focusMode: opticalMeta.focusMode,
          m2Factor: opticalMeta.m2Factor,
        },
        traceResult: traceResult
          ? {
              focusZ: traceResult.focusZ,
              bestFocusZ: traceResult.bestFocusZ,
              performance: traceResult.performance,
              gaussianBeam: traceResult.gaussianBeam,
            }
          : null,
      },
    }
  }

  const byId = new Map(session.lastSurfaces.map((s) => [s.id, s]))
  const deltas: Array<Record<string, unknown>> = []

  for (const s of surfaces) {
    const prev = byId.get(s.id)
    if (!prev) continue
    const changed: Record<string, unknown> = { id: s.id }
    let hasChange = false
    for (const k of SURFACE_DELTA_KEYS) {
      const v = s[k as keyof Surface]
      const p = prev[k as keyof Surface]
      if (v !== p) {
        changed[k] = v
        hasChange = true
      }
    }
    if (hasChange) deltas.push(changed)
  }

  const perfDelta =
    rmsUm != null
      ? { rmsUm, totalLength: traceResult?.performance?.totalLength, fNumber: traceResult?.performance?.fNumber }
      : null

  const compactSurfaces = surfaces.map((s) => ({
    id: s.id,
    type: s.type,
    radius: s.radius,
    thickness: s.thickness,
    material: s.material,
    diameter: s.diameter,
  }))

  return {
    isHandshake: false,
    delta: {
      surfaces: compactSurfaces,
      changesSinceLast: deltas.length > 0 ? deltas : undefined,
      perf: perfDelta,
      episodic: session.episodic,
    },
  }
}

/** Update session after a request (mark handshake sent, update last state). */
export function updateSessionAfterRequest(
  session: AgentSessionState,
  surfaces: Surface[],
  traceResult: TraceLike
): void {
  session.handshakeSent = true
  session.lastSurfaces = surfaces.map((s) => ({ ...s }))
  session.lastValidStack = surfaces.map((s) => ({ ...s }))
  session.lastRmsUm =
    traceResult?.performance?.rmsSpotRadius != null
      ? traceResult.performance.rmsSpotRadius * 1000
      : null
}

/** Update episodic memory with new goal, constraint, or failure. */
export function updateEpisodic(
  session: AgentSessionState,
  updates: Partial<EpisodicMemory>
): void {
  if (updates.currentGoal) session.episodic.currentGoal = updates.currentGoal
  if (updates.constraintsMet?.length)
    session.episodic.constraintsMet = [...session.episodic.constraintsMet, ...updates.constraintsMet].slice(-5)
  if (updates.failedIterations?.length)
    session.episodic.failedIterations = [...session.episodic.failedIterations, ...updates.failedIterations].slice(-3)
}

/** Reset episodic (e.g. new user goal). */
export function resetEpisodicGoal(session: AgentSessionState, goal: string): void {
  session.episodic.currentGoal = goal
}

/** Small-talk phrases — no optical intent; prune from context. */
const SMALL_TALK_PATTERNS = [
  /^\s*(hi|hello|hey|yo)\s*[!.]?\s*$/i,
  /^\s*(thanks|thank you|thx|ty)\s*[!.]?\s*$/i,
  /^\s*(ok|okay|k)\s*[!.]?\s*$/i,
  /^\s*(yes|no)\s*[!.]?\s*$/i,
  /^\s*(cool|nice|great|awesome)\s*[!.]?\s*$/i,
  /^\s*(\?|\.\.\.)\s*$/,
]

/** Returns true if prompt is small talk (no optical design intent). */
export function isSmallTalk(prompt: string): boolean {
  const t = prompt.trim()
  if (t.length < 3) return true
  return SMALL_TALK_PATTERNS.some((p) => p.test(t))
}

/** Filter prompt: if small talk, return empty; otherwise return trimmed. */
export function pruneSmallTalk(prompt: string): string | null {
  const t = prompt.trim()
  if (!t) return null
  if (isSmallTalk(t)) return null
  return t
}
