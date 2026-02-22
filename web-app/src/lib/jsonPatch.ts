/**
 * JSON Patch (RFC 6902) — minimal apply for surface updates.
 * Agent can return patch instead of surfaceDeltas for token efficiency.
 */

import type { Surface } from '../types/system'
import type { SurfaceDelta } from '../types/agent'

/** RFC 6902 operation */
type JsonPatchOp = { op: 'replace' | 'add'; path: string; value?: unknown }

/** Parse JSON Patch from agent response. Returns null if invalid. */
export function parseJsonPatch(text: string): JsonPatchOp[] | null {
  try {
    const parsed = JSON.parse(text) as unknown
    if (Array.isArray(parsed)) {
      const ops = parsed.filter(
        (p): p is JsonPatchOp =>
          p && typeof p === 'object' && typeof (p as JsonPatchOp).op === 'string' && typeof (p as JsonPatchOp).path === 'string'
      )
      return ops.length > 0 ? ops : null
    }
    if (parsed && typeof parsed === 'object' && 'patch' in parsed) {
      const patch = (parsed as { patch: unknown }).patch
      return Array.isArray(patch) ? (patch as JsonPatchOp[]) : null
    }
    return null
  } catch {
    return null
  }
}

/** Convert JSON Patch to SurfaceDelta[] for compatibility with applyTransaction. */
export function patchToSurfaceDeltas(patch: JsonPatchOp[], surfaces: Surface[]): SurfaceDelta[] {
  const deltasById = new Map<string, SurfaceDelta>()

  for (const op of patch) {
    const m = op.path.match(/^\/surfaces\/(\d+)\/(.+)$/) || op.path.match(/^\/optical_stack\/surfaces\/(\d+)\/(.+)$/)
    if (!m) continue
    const idx = parseInt(m[1], 10)
    const field = m[2].replace(/^\//, '')
    const surf = surfaces[idx]
    if (!surf) continue

    let d = deltasById.get(surf.id)
    if (!d) {
      d = { id: surf.id }
      deltasById.set(surf.id, d)
    }

    if (op.op === 'replace' || op.op === 'add') {
      const key = field as keyof SurfaceDelta
      if (key in d || key === 'id') continue
      ;(d as Record<string, unknown>)[key] = op.value
    }
  }

  return Array.from(deltasById.values())
}

/** Alternative: path uses surface id. E.g. /surfaces/surf-123/thickness */
export function patchToSurfaceDeltasById(patch: JsonPatchOp[], surfaces: Surface[]): SurfaceDelta[] {
  const deltasById = new Map<string, SurfaceDelta>()

  for (const op of patch) {
    const m = op.path.match(/^\/(?:surfaces|optical_stack\/surfaces)\/([^/]+)\/(.+)$/)
    if (!m) continue
    const id = m[1]
    const field = m[2].replace(/^\//, '')
    const surf = surfaces.find((s) => s.id === id)
    if (!surf) continue

    let d = deltasById.get(id)
    if (!d) {
      d = { id }
      deltasById.set(id, d)
    }

    if (op.op === 'replace' || op.op === 'add') {
      const key = field as keyof SurfaceDelta
      if (key === 'id') continue
      ;(d as Record<string, unknown>)[key] = op.value
    }
  }

  return Array.from(deltasById.values())
}
