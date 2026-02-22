/**
 * LeapOS Agent Orchestrator — Physics-Agent Bridge (AgentBridge).
 * Agent-Agnostic: each agent receives a State Snapshot (JSON) and returns a Diff of proposed changes.
 * Plug in new models (Claude 4, GPT-5) without rebuilding — just add to AgentModel type.
 *
 * SECURITY: API keys are used ONLY for requests to official provider endpoints
 * (api.anthropic.com, api.openai.com, api.deepseek.com). Keys are never logged or sent elsewhere.
 */

import type { Surface, SystemState, TraceResult, FocusMode } from '../types/system'

/** Multi-Physics Auditor: validation result with violation list. */
export type ValidationReport = {
  isValid: boolean
  violations: Array<{ category: string; message: string }>
}
import type { AgentTransaction, SurfaceDelta, AgentModel, ImageAttachment } from '../types/agent'
import { config } from '../config'
import { traceOpticalStack } from '../api/trace'
import type { AgentSessionState, EpisodicMemory } from './agentSession'
import { getStateDelta, updateSessionAfterRequest, updateEpisodic, resetEpisodicGoal, pruneSmallTalk, PHYSICS_CONSTRAINTS } from './agentSession'
import { routeModel, ROUTING_ENABLED } from './agentRouter'

/** Detect if an API error or model response indicates the model does not support images. */
function isVisionUnsupportedError(msg: string): boolean {
  const lower = msg.toLowerCase()
  return (
    /does not support (image|vision)/.test(lower) ||
    /do not support (image|vision)/.test(lower) ||
    /don't support (image|vision)/.test(lower) ||
    /image message content type/.test(lower) ||
    /model does not support image/.test(lower)
  )
}

/** Extract a clean vision-unsupported message from API error (OpenAI/LM Studio JSON format). */
function extractVisionErrorFromApi(msg: string): string {
  try {
    const jsonStart = msg.indexOf('{')
    if (jsonStart >= 0) {
      const parsed = JSON.parse(msg.slice(jsonStart)) as { error?: { message?: string } }
      const inner = parsed?.error?.message
      if (inner) return `The model does not support images. ${inner}`
    }
  } catch {
    // fall through
  }
  return `The model does not support images. ${msg.slice(0, 200)}`
}

/** Detect if model response text (when parse fails) indicates it cannot process images. */
function modelRefusesImages(text: string): string | null {
  const patterns = [
    /(?:i |i'm |i am )(?:cannot|can't|can not|do not|don't) (?:process|see|analyze|handle) (?:images?|pictures?|visual)/i,
    /(?:i |i'm |i am )(?:only work|limited to) (?:text|written)/i,
    /(?:as an? (?:ai|language model|llm),? )?(?:i )?(?:can only work|cannot process) (?:with )?text/i,
    /(?:this )?model (?:does not|doesn't) support (?:images?|vision)/i,
    /(?:there is )?no image/i,
    /(?:i )?(?:cannot|can't) (?:process|analyze|see) (?:the )?(?:attached )?image/i,
  ]
  for (const p of patterns) {
    const m = text.match(p)
    if (m) return m[0].slice(0, 120)
  }
  return null
}

/** Check if we have an API key for the given model. Router must not override to a model we can't use. */
function hasKeyForModel(model: string, apiKeys?: { openai?: string; anthropic?: string; deepseek?: string }): boolean {
  if (!apiKeys) return false
  if (model.startsWith('claude')) return Boolean(apiKeys.anthropic?.trim())
  if (model.startsWith('gpt') || model.startsWith('o1')) return Boolean(apiKeys.openai?.trim())
  if (model.startsWith('deepseek')) return Boolean(apiKeys.deepseek?.trim())
  return false
}

import { parseJsonPatch, patchToSurfaceDeltasById } from './jsonPatch'
import { appendThoughtTrace } from './thoughtTrace'
import { enrichSurfaceWithPhysics } from './latticePhysics'

/** PhotonLeap Physicist System Identity — transforms general-purpose LLM into Optical & Quantum Architect */
const PHYSICIST_SYSTEM_PROMPT = `Role: You are the PhotonLeap Lead Physicist, an expert in classical ray optics, wave propagation, and quantum information science. Your goal is to design, optimize, and troubleshoot physical systems within the PhotonLeap environment.

## Core Competencies
- Geometric Optics: Expert in Snell's Law, the Lensmaker's Equation, and Seidel aberrations (Spherical, Coma, Astigmatism, Field Curvature, Distortion).
- Physical Optics: Mastery of Gaussian beam propagation (M² factors, beam waist, Rayleigh range) and diffraction limits.
- Quantum States: Expertise in polarization (Jones Calculus), photon entanglement, and Bloch sphere mapping.

## Operational Protocol
- Zero-Error Physics: Every design must respect the Law of Conservation of Energy and the Second Law of Thermodynamics. You cannot "create" light without a defined source.
- Manufacturing Awareness: Favor "buildable" designs. Avoid center thicknesses <1mm or curvatures that create "knife-edges" on lens peripheries. |radius| must be >= diameter to avoid impossible curves.

## Optical Stack Schema (Dual-Purpose Semantic Lattice)
Each surface has:
- id (string, required): unique identifier — MUST match existing surface ids exactly
- semanticName (string): e.g. "Primary_Objective", "Field_Flattener"
- aiContext (string): reason for surface, e.g. "Corrects coma from S1"
- type: "Glass" | "Air"
- radius (mm): curvature radius; positive = convex toward +z, negative = concave; 0 = flat
- thickness (mm): distance to next surface
- refractiveIndex: n at primary wavelength
- diameter (mm): clear aperture
- material (string): must be from glass library
- description, coating
- effective_focal_length (mm): computed R/(n-1) for curved surfaces; null for plano
- critical_angle (deg): TIR angle for glass→air; null for air

## Glass Library (exact names)
N-BK7, N-SF11, N-SF5, N-SF6, N-SF10, N-SF14, N-F2, N-SK2, Fused Silica, N-BAF10, N-LAK9, H-LAF7, Calcium Fluoride, Magnesium Fluoride, Sapphire, N-K5, N-SK16, N-BAF4, N-SF6HT, N-LAK14, N-BK10, N-SF57, N-SF66, N-SF15

## Output Format
Your response must be a valid JSON object. Do not include any text outside of the JSON structure.
Return ONLY valid JSON. No conversational filler unless requested.

Preferred (token-efficient): JSON Patch RFC 6902 — e.g. [{"op":"replace","path":"/surfaces/<id>/thickness","value":8}]
Full format: {"surfaceDeltas":[{"id":"surf-uuid","radius":50,"thickness":5,"material":"N-BK7",...}],"reasoning":"brief physics explanation"}

Optional: If design is physically impossible (e.g. TIR preventing beam exit), include:
{"physicsViolation":true,"reason":"description","suggestedAlternative":"geometry hint","surfaceDeltas":[],"reasoning":"..."}

## Constraints
- radius must be non-zero for Glass surfaces
- thickness > 0, diameter > 0
- |radius| >= diameter to avoid knife-edges (impossible curves)
- If design fails physical validation, you will receive error context; propose a new transaction.`

/** Optical Physics Constants — static, cacheable (~200 tokens). Never changes. */
const OPTICAL_PHYSICS_CONSTANTS = `
## Physics Constants (immutable)
- Snell: n₁sin(θ₁)=n₂sin(θ₂). TIR when θ ≥ arcsin(n₂/n₁).
- Lensmaker (thin): 1/f = (n-1)(1/R₁ - 1/R₂).
- Glass library: N-BK7, N-SF11, Fused Silica, N-SF5, N-SF6, N-SF10, N-SF14, N-F2, N-SK2, N-BAF10, N-LAK9, H-LAF7, Calcium Fluoride, Magnesium Fluoride, Sapphire, N-K5, N-SK16, N-BAF4, N-SF6HT, N-LAK14, N-BK10, N-SF57, N-SF66, N-SF15.
`

/** ACE: Cacheable prefix — System Identity + Constants. First ~1000 tokens, never changes. */
const ACE_CACHEABLE_PREFIX = PHYSICIST_SYSTEM_PROMPT + OPTICAL_PHYSICS_CONSTANTS

/** Physics Validator: intercepts AI-generated designs. If agent proposes lens violating physical invariants,
 * feeds error back to agent for second pass. */

/** Build system message with current optical context (State Snapshot) */
export function buildSystemMessage(
  optical_stack: { surfaces: Surface[]; entrancePupilDiameter: number; wavelengths: number[]; fieldAngles: number[]; numRays: number; focusMode?: string; m2Factor?: number },
  traceResult: TraceResult | null
): string {
  const ctx = {
    optical_stack: {
      surfaces: optical_stack.surfaces.map((s) => {
        const enriched = enrichSurfaceWithPhysics(s)
        return {
          id: enriched.id,
          semanticName: enriched.semanticName ?? `S${optical_stack.surfaces.indexOf(s) + 1}`,
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
      entrancePupilDiameter: optical_stack.entrancePupilDiameter,
      wavelengths: optical_stack.wavelengths,
      fieldAngles: optical_stack.fieldAngles,
      numRays: optical_stack.numRays,
    },
    traceResult: traceResult
      ? {
          focusZ: traceResult.focusZ,
          bestFocusZ: traceResult.bestFocusZ,
          performance: traceResult.performance,
          gaussianBeam: traceResult.gaussianBeam,
        }
      : null,
  }
  return `${ACE_CACHEABLE_PREFIX}\n\n## Current System State (JSON)\n\`\`\`json\n${JSON.stringify(ctx, null, 2)}\n\`\`\``
}

/** Build system message from state delta (token-efficient: handshake once, then delta-only). */
export function buildSystemMessageFromDelta(
  delta: object,
  isHandshake: boolean,
  episodic: EpisodicMemory
): string {
  /** Differential Memory: Context Summary only — no full chat history */
  const episodicBlock =
    episodic.currentGoal || episodic.constraintsMet.length || episodic.failedIterations.length
      ? `\n## Context Summary\n- Current Goal: ${episodic.currentGoal || 'None'}\n- Constraints Met: ${episodic.constraintsMet.join('; ') || 'None'}\n- Failed Iterations: ${episodic.failedIterations.join('; ') || 'None'}\n- Physics Constraints: ${PHYSICS_CONSTRAINTS}`
      : ''
  const label = isHandshake ? 'Full Handshake (JSON)' : 'State Delta (compact)'
  return `${ACE_CACHEABLE_PREFIX}${episodicBlock}\n\n## ${label}\n\`\`\`json\n${JSON.stringify(delta)}\n\`\`\``
}

/** Strip <think>...</think> blocks (DeepSeek R1, LM Studio reasoning models) — keep only content after for parsing.
 * Handles: <think></think>, <<think>>...<<</think>>>, and unclosed blocks.
 * Raw thoughts are saved to thought_trace for debugging (not re-sent to context). */
function stripThinkBlocks(text: string, options?: { model?: string; promptPreview?: string; saveThoughts?: boolean }): string {
  const thinkOpen = '(?:<think>|<<think>>)'
  const thinkClose = '(?:</think>|<<\\/think>>)'
  const openRegex = new RegExp(thinkOpen, 'gi')

  if (options?.saveThoughts && options.model && options.promptPreview) {
    const matches = text.matchAll(new RegExp(thinkOpen + '([\\s\\S]*?)' + thinkClose, 'gi'))
    for (const m of matches) {
      if (m[1]) appendThoughtTrace(options.model, options.promptPreview, m[1])
    }
    const unclosed = text.match(new RegExp(thinkOpen + '[\\s\\S]*$', 'i'))
    if (unclosed) {
      const content = unclosed[0].replace(openRegex, '').trim()
      if (content) appendThoughtTrace(options.model, options.promptPreview, content)
    }
  }

  let result = text
  result = result.replace(new RegExp(thinkOpen + '[\\s\\S]*?' + thinkClose, 'gi'), '')
  result = result.replace(new RegExp(thinkOpen + '[\\s\\S]*$', 'gi'), '')
  return result.trim()
}

/** Extract JSON string from content — tries raw JSON, then markdown ```json ... ``` blocks. */
function extractJsonString(text: string, thinkOptions?: Parameters<typeof stripThinkBlocks>[1]): string | null {
  const stripped = stripThinkBlocks(text, thinkOptions)
  const trimmed = stripped.trim()
  // 1. Try markdown code block first: ```json ... ``` or ``` ... ```
  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlock) {
    const inner = codeBlock[1].trim()
    if (inner) return inner
  }
  // 2. Try to find a JSON object in the string (greedy match for nested braces)
  const objMatch = trimmed.match(/\{[\s\S]*\}/)
  if (objMatch) return objMatch[0]
  // 3. Fallback: use trimmed string as-is if it looks like JSON
  if (trimmed.startsWith('{')) return trimmed
  return null
}

type ParseTransactionOptions = { model?: string; promptPreview?: string; saveThoughts?: boolean }

/** Parse LLM response for AgentTransaction. Supports surfaceDeltas and JSON Patch (RFC 6902). */
export function parseTransaction(text: string, surfaces: Surface[], options?: ParseTransactionOptions): AgentTransaction | null {
  const thinkOpts = options?.saveThoughts && options.model && options.promptPreview
    ? { model: options.model, promptPreview: options.promptPreview, saveThoughts: true }
    : undefined
  const stripped = stripThinkBlocks(text, thinkOpts)
  const strategies = [
    () => extractJsonString(text, thinkOpts),
    () => extractJsonString(stripped, thinkOpts),
    () => {
      const blocks = stripped.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)
      for (const m of blocks) {
        const inner = m[1]?.trim()
        if (inner?.startsWith('{') || inner?.startsWith('[')) return inner
      }
      return null
    },
  ]

  for (const getJson of strategies) {
    const jsonStr = getJson()
    if (!jsonStr) continue
    try {
      const parsed = JSON.parse(jsonStr) as unknown
      if (Array.isArray(parsed)) {
        const patch = parseJsonPatch(jsonStr)
        if (patch && patch.length > 0) {
          const surfaceDeltas = patchToSurfaceDeltasById(patch, surfaces)
          if (surfaceDeltas.length > 0) {
            return { surfaceDeltas, reasoning: 'Applied via JSON Patch' }
          }
        }
      }
      const surfaceDeltas = (parsed as { surfaceDeltas?: unknown; surface_deltas?: unknown }).surfaceDeltas
        ?? (parsed as { surface_deltas?: unknown }).surface_deltas
      if (parsed && typeof parsed === 'object' && Array.isArray(surfaceDeltas)) {
        const t = parsed as { reasoning?: string; physicsViolation?: boolean; reason?: string; suggestedAlternative?: string }
        return {
          surfaceDeltas: surfaceDeltas.filter((d): d is SurfaceDelta =>
            d != null && typeof d === 'object' && typeof (d as Record<string, unknown>).id === 'string'
          ),
          reasoning: t.reasoning,
          physicsViolation: t.physicsViolation,
          reason: t.reason,
          suggestedAlternative: t.suggestedAlternative,
        }
      }
    } catch {
      continue
    }
  }
  return null
}

/** Apply surfaceDeltas to surfaces by id. Returns new surfaces array. */
export function applyTransaction(surfaces: Surface[], transaction: AgentTransaction): Surface[] {
  const byId = new Map(surfaces.map((s) => [s.id, { ...s }]))
  for (const delta of transaction.surfaceDeltas) {
    const surf = byId.get(delta.id)
    if (!surf) continue
    if (delta.semanticName !== undefined) surf.semanticName = delta.semanticName
    if (delta.aiContext !== undefined) surf.aiContext = delta.aiContext
    if (delta.radius !== undefined) surf.radius = delta.radius
    if (delta.thickness !== undefined) surf.thickness = delta.thickness
    if (delta.refractiveIndex !== undefined) surf.refractiveIndex = delta.refractiveIndex
    if (delta.diameter !== undefined) surf.diameter = delta.diameter
    if (delta.material !== undefined) surf.material = delta.material
    if (delta.description !== undefined) surf.description = delta.description
    if (delta.type !== undefined) surf.type = delta.type
    if (delta.coating !== undefined) surf.coating = delta.coating
    if (delta.sellmeierCoefficients !== undefined) surf.sellmeierCoefficients = delta.sellmeierCoefficients
  }
  return Array.from(byId.values())
}

/** Physics Pre-Flight: validate transaction before UI update. Catches impossible curves, physics violations. */
export function validateTransaction(surfaces: Surface[], transaction: AgentTransaction): { valid: boolean; error?: string } {
  const after = applyTransaction(surfaces, transaction)
  for (const s of after) {
    if (s.type === 'Glass' && s.radius === 0) {
      return { valid: false, error: `Surface ${s.id} (Glass) cannot have radius 0` }
    }
    if (s.thickness < 0) {
      return { valid: false, error: `Surface ${s.id} has negative thickness` }
    }
    if (s.diameter <= 0) {
      return { valid: false, error: `Surface ${s.id} has invalid diameter` }
    }
    if (s.radius !== 0 && Math.abs(s.radius) < s.diameter) {
      return { valid: false, error: `Surface ${s.id} impossible curve: |radius| ${Math.abs(s.radius)}mm < diameter ${s.diameter}mm — would create knife-edge` }
    }
  }
  return { valid: true }
}

/** Trace-like input for Multi-Physics Auditor (performance, rayPower, terminationLog) */
type TraceForAudit = {
  performance?: { rmsSpotRadius: number; totalLength: number }
  rayPower?: number[]
  terminationLog?: Array<{ reason?: string; surf?: number }>
} | null

/** Multi-Physics Auditor: validate optical_stack + trace against physical invariants.
 * Returns ValidationReport with violations. Used after trace to catch impossible designs. */
export function validatePhysicalState(surfaces: Surface[], traceResult: TraceForAudit): ValidationReport {
  const violations: Array<{ category: string; message: string }> = []

  // Geometry: hyper-sphere (thickness > radius*2), knife-edge already in validateTransaction
  for (const s of surfaces) {
    if (s.type === 'Glass' && s.radius !== 0 && s.thickness > Math.abs(s.radius) * 2) {
      violations.push({
        category: 'Geometry',
        message: `Surface ${s.id}: thickness ${s.thickness}mm > |radius|×2 (${Math.abs(s.radius) * 2}mm) — hyper-sphere cannot be built`,
      })
    }
  }

  // Material: impossible glass (n < 1)
  for (const s of surfaces) {
    if (s.type === 'Glass' && s.refractiveIndex < 1.0) {
      violations.push({
        category: 'Material',
        message: `Surface ${s.id}: refractiveIndex ${s.refractiveIndex} < 1.0 — impossible glass`,
      })
    }
  }

  // Energy: ray power > 1 (conservation violation)
  const rayPower = traceResult?.rayPower
  if (rayPower?.length) {
    const overUnity = rayPower.filter((p) => p > 1.0).length
    if (overUnity > 0) {
      violations.push({
        category: 'Energy',
        message: `${overUnity} ray(s) have transmitted power > 1.0 — energy conservation violated`,
      })
    }
  }

  // Operational: total path length exceeds bench
  const totalLength = traceResult?.performance?.totalLength ?? surfaces.reduce((sum, s) => sum + s.thickness, 0)
  if (totalLength > config.agentMaxBenchSizeMm) {
    violations.push({
      category: 'Operational',
      message: `Total path length ${totalLength.toFixed(1)}mm exceeds max bench size ${config.agentMaxBenchSizeMm}mm`,
    })
  }

  // Aspect ratio: diameter/thickness > 20 (too fragile)
  for (let i = 0; i < surfaces.length; i++) {
    const s = surfaces[i]
    if (s.type === 'Glass' && s.thickness > 0 && s.diameter / s.thickness > config.agentMaxAspectRatio) {
      violations.push({
        category: 'Geometry',
        message: `Surface ${s.id}: aspect ratio diameter/thickness = ${(s.diameter / s.thickness).toFixed(1)} > ${config.agentMaxAspectRatio} — too fragile to manufacture`,
      })
    }
  }

  // TIR: ray escaped at unintended surface (from termination log)
  const termLog = traceResult?.terminationLog
  if (termLog?.length) {
    const tirTerms = termLog.filter((t) => /tir|total.?internal.?reflection/i.test(t.reason ?? ''))
    if (tirTerms.length > 0) {
      const surfIds = [...new Set(tirTerms.map((t) => t.surf).filter((x): x is number => x != null))]
      violations.push({
        category: 'Energy',
        message: `Total Internal Reflection at surface(s) ${surfIds.join(', ')} — ray may not exit as intended`,
      })
    }
  }

  return {
    isValid: violations.length === 0,
    violations,
  }
}

/** Detect if error indicates local server unreachable (network/connection failure) */
function isLocalUnreachableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  const lower = msg.toLowerCase()
  return (
    lower.includes('failed to fetch') ||
    lower.includes('network') ||
    lower.includes('connection refused') ||
    lower.includes('net::err_') ||
    lower.includes('load failed') ||
    lower.includes('could not connect')
  )
}

/** LM Studio native API base (streaming with reasoning.delta) — derived from config */
function getLMStudioNativeBase(): string {
  const base = config.localAgent.apiBase.replace(/\/v1\/?$/, '')
  return `${base}/api/v1`
}

/** In local mode, use the model ID as-is (user-configured from Uplink). Fallback to config if empty. */
function getLocalModelId(model: string): string {
  return model?.trim() || config.localAgent.modelId
}

/** Check if LM Studio model supports vision via /api/v1/models. Returns true/false, or null if check fails. */
async function getLocalModelVisionSupport(modelId: string): Promise<boolean | null> {
  try {
    const base = config.localAgent.apiBase.replace(/\/v1\/?$/, '')
    const res = await fetch(`${base}/api/v1/models`, {
      headers: { Authorization: `Bearer ${config.localAgent.apiKey}` },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { models?: Array<{ key?: string; capabilities?: { vision?: boolean }; loaded_instances?: Array<{ id?: string }> }> }
    const models = data.models ?? []
    const id = modelId.toLowerCase()
    for (const m of models) {
      const keyMatch = m.key?.toLowerCase() === id
      const loadedMatch = m.loaded_instances?.some((i) => i.id?.toLowerCase() === id)
      if (keyMatch || loadedMatch) {
        return m.capabilities?.vision === true
      }
    }
    return null
  } catch {
    return null
  }
}

/** Build user content for APIs that support multimodal (images + text). */
function buildUserContent(userMessage: string, images?: ImageAttachment[]): string | unknown[] {
  if (!images?.length) return userMessage
  const textBlock = { type: 'text' as const, text: userMessage }
  const imageBlocks = images.map((img) => ({
    type: 'image' as const,
    source: { type: 'base64' as const, media_type: img.mediaType, data: img.data },
  }))
  return [...imageBlocks, textBlock]
}

/** Build user content for OpenAI/DeepSeek/LM Studio format (image_url). */
function buildUserContentOpenAI(userMessage: string, images?: ImageAttachment[]): string | unknown[] {
  if (!images?.length) return userMessage
  const textBlock = { type: 'text' as const, text: userMessage }
  const imageBlocks = images.map((img) => ({
    type: 'image_url' as const,
    image_url: { url: `data:${img.mediaType};base64,${img.data}` },
  }))
  return [...imageBlocks, textBlock]
}

/** ACE: Split system into cacheable prefix (~1000 tokens) + variable. Anthropic prompt caching. */
function buildAnthropicSystemWithCache(systemMessage: string): unknown {
  const variablePart = systemMessage.slice(ACE_CACHEABLE_PREFIX.length)
  return [
    { type: 'text' as const, text: ACE_CACHEABLE_PREFIX, cache_control: { type: 'ephemeral' as const } },
    { type: 'text' as const, text: variablePart },
  ]
}

/** Stream Anthropic Messages API — thinking_delta or text_delta to onThinking, returns full text */
async function callAnthropicStreaming(
  apiKey: string,
  model: string,
  systemMessage: string,
  userMessage: string,
  onThinking: (chunk: string) => void,
  signal?: AbortSignal,
  enableThinking?: boolean,
  images?: ImageAttachment[]
): Promise<string> {
  const userContent = buildUserContent(userMessage, images)
  const body: Record<string, unknown> = {
    model,
    max_tokens: 2048,
    stream: true,
    system: buildAnthropicSystemWithCache(systemMessage),
    messages: [{ role: 'user', content: userContent }],
  }
  if (enableThinking) {
    body.thinking = { type: 'enabled', budget_tokens: 4000 }
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Anthropic API error: ${res.status} ${err}`)
  }
  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const raw = line.slice(6).trim()
        if (!raw || raw === '[DONE]') continue
        try {
          const data = JSON.parse(raw) as { type?: string; delta?: { type?: string; thinking?: string; text?: string } }
          if (data.type === 'content_block_delta' && data.delta) {
            if (data.delta.type === 'thinking_delta' && typeof data.delta.thinking === 'string') {
              onThinking(data.delta.thinking)
            } else if (data.delta.type === 'text_delta' && typeof data.delta.text === 'string') {
              onThinking(data.delta.text)
              fullText += data.delta.text
            }
          }
        } catch {
          // skip malformed JSON
        }
      }
    }
  }
  for (const line of buffer.split('\n')) {
    if (line.startsWith('data: ')) {
      const raw = line.slice(6).trim()
      if (!raw || raw === '[DONE]') continue
      try {
        const data = JSON.parse(raw) as { type?: string; delta?: { type?: string; thinking?: string; text?: string } }
        if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta' && typeof data.delta.text === 'string') {
          fullText += data.delta.text
        }
      } catch {
        // skip
      }
    }
  }
  return fullText
}

/** Stream OpenAI Chat Completions — content delta to onThinking, returns full content */
async function callOpenAIStreaming(
  apiKey: string,
  model: string,
  systemMessage: string,
  userMessage: string,
  onThinking: (chunk: string) => void,
  signal?: AbortSignal,
  images?: ImageAttachment[]
): Promise<string> {
  const userContent = buildUserContentOpenAI(userMessage, images)
  const body: Record<string, unknown> = {
    model,
    max_tokens: 2048,
    stream: true,
    messages: [
      { role: 'system', content: systemMessage },
      { role: 'user', content: userContent },
    ],
  }
  if (model.startsWith('o1')) body.reasoning_effort = 'medium'
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenAI API error: ${res.status} ${err}`)
  }
  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')
  const decoder = new TextDecoder()
  let buffer = ''
  let fullContent = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const raw = line.slice(6).trim()
        if (!raw || raw === '[DONE]') continue
        try {
          const data = JSON.parse(raw) as { choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }> }
          const delta = data.choices?.[0]?.delta
          if (delta) {
            if (typeof delta.reasoning_content === 'string') {
              onThinking(delta.reasoning_content)
            }
            if (typeof delta.content === 'string') {
              onThinking(delta.content)
              fullContent += delta.content
            }
          }
        } catch {
          // skip
        }
      }
    }
  }
  for (const line of buffer.split('\n')) {
    if (line.startsWith('data: ')) {
      const raw = line.slice(6).trim()
      if (!raw || raw === '[DONE]') continue
      try {
        const delta = (JSON.parse(raw) as { choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }> }).choices?.[0]?.delta
        if (delta?.content) fullContent += delta.content
      } catch {
        // skip
      }
    }
  }
  return fullContent
}

/** Stream DeepSeek Chat Completions — reasoning_content or content to onThinking.
 * Progressive max_tokens: 16K → 32K → 64K on retries so complex reasoning can complete. */
async function callDeepSeekStreaming(
  apiKey: string,
  model: string,
  systemMessage: string,
  userMessage: string,
  onThinking: (chunk: string) => void,
  signal?: AbortSignal,
  attempt = 0,
  images?: ImageAttachment[]
): Promise<string> {
  const maxTokens = Math.min(16384 * (1 << Math.min(attempt, 2)), 65536)
  const userContent = buildUserContentOpenAI(userMessage, images)
  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      stream: true,
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: userContent },
      ],
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`DeepSeek API error: ${res.status} ${err}`)
  }
  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')
  const decoder = new TextDecoder()
  let buffer = ''
  let fullContent = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const raw = line.slice(6).trim()
        if (!raw || raw === '[DONE]') continue
        try {
          const data = JSON.parse(raw) as { choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }> }
          const delta = data.choices?.[0]?.delta
          if (delta) {
            if (typeof delta.reasoning_content === 'string') {
              onThinking(delta.reasoning_content)
            }
            if (typeof delta.content === 'string') {
              onThinking(delta.content)
              fullContent += delta.content
            }
          }
        } catch {
          // skip
        }
      }
    }
  }
  for (const line of buffer.split('\n')) {
    if (line.startsWith('data: ')) {
      const raw = line.slice(6).trim()
      if (!raw || raw === '[DONE]') continue
      try {
        const delta = (JSON.parse(raw) as { choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }> }).choices?.[0]?.delta
        if (delta?.content) fullContent += delta.content
      } catch {
        // skip
      }
    }
  }
  return fullContent
}

/** Parse <think>...</think> blocks from message stream — used when LM Studio doesn't emit reasoning.delta (e.g. grok-3-gemma3-12b) */
function parseThinkBlocks(
  chunk: string,
  state: { inThink: boolean; pending: string },
  onThinking: (chunk: string) => void
): string {
  const s = state.pending + chunk
  state.pending = ''
  let messagePart = ''
  if (state.inThink) {
    const endIdx = s.indexOf('</think>')
    if (endIdx >= 0) {
      onThinking(s.slice(0, endIdx))
      messagePart = s.slice(endIdx + 8)
      state.inThink = false
      const recurse = parseThinkBlocks(messagePart, state, onThinking)
      return recurse
    }
    onThinking(s)
    return ''
  }
  const startIdx = s.indexOf('<think>')
  if (startIdx >= 0) {
    messagePart = s.slice(0, startIdx)
    const afterStart = s.slice(startIdx + 8)
    const endIdx = afterStart.indexOf('</think>')
    if (endIdx >= 0) {
      onThinking(afterStart.slice(0, endIdx))
      return messagePart + parseThinkBlocks(afterStart.slice(endIdx + 8), state, onThinking)
    }
    state.inThink = true
    onThinking(afterStart)
    return messagePart
  }
  const lastStart = s.lastIndexOf('<think>')
  if (lastStart >= 0 && lastStart > s.length - 8) {
    state.pending = s.slice(lastStart)
    return s.slice(0, lastStart)
  }
  const lastEnd = s.lastIndexOf('</think>')
  if (lastEnd >= 0 && lastEnd > s.length - 8) {
    state.pending = s.slice(lastEnd)
    return s.slice(0, lastEnd)
  }
  return s
}

/** Stream LLM via LM Studio — native API when text-only; OpenAI-compatible when images present.
 * Supports: (1) reasoning.delta events, (2) <think>...</think> in message.delta (grok-3-gemma3-12b, etc.) */
async function callLLMStreaming(
  model: AgentModel | string,
  systemMessage: string,
  userMessage: string,
  onThinking: (chunk: string) => void,
  signal?: AbortSignal,
  images?: ImageAttachment[]
): Promise<string> {
  const { apiBase, apiKey } = config.localAgent
  const modelId = getLocalModelId(model)

  // When images present: use OpenAI-compatible endpoint (native API is text-only)
  if (images?.length) {
    const userContent = buildUserContentOpenAI(userMessage, images)
    const res = await fetch(`${apiBase}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 2048,
        stream: true,
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: userContent },
        ],
      }),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Local API error: ${res.status} ${err}`)
    }
    const reader = res.body?.getReader()
    if (!reader) throw new Error('No response body')
    const decoder = new TextDecoder()
    let buffer = ''
    let fullContent = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const raw = line.slice(6).trim()
          if (!raw || raw === '[DONE]') continue
          try {
            const data = JSON.parse(raw) as { choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }> }
            const delta = data.choices?.[0]?.delta
            if (delta) {
              if (typeof delta.reasoning_content === 'string') onThinking(delta.reasoning_content)
              if (typeof delta.content === 'string') {
                onThinking(delta.content)
                fullContent += delta.content
              }
            }
          } catch {
            // skip
          }
        }
      }
    }
    for (const line of buffer.split('\n')) {
      if (line.startsWith('data: ')) {
        const raw = line.slice(6).trim()
        if (!raw || raw === '[DONE]') continue
        try {
          const delta = (JSON.parse(raw) as { choices?: Array<{ delta?: { content?: string } }> }).choices?.[0]?.delta
          if (delta?.content) fullContent += delta.content
        } catch {
          // skip
        }
      }
    }
    return fullContent
  }

  // Text-only: LM Studio native API for real-time reasoning
  const url = `${getLMStudioNativeBase()}/chat`
  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      input: userMessage,
      system_prompt: systemMessage,
      stream: true,
      max_output_tokens: 2048,
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Local API error: ${res.status} ${err}`)
  }
  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')
  const decoder = new TextDecoder()
  let buffer = ''
  let fullMessage = ''
  const thinkState = { inThink: false, pending: '' }
  let hasReasoningDelta = false
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const raw = line.slice(6).trim()
        if (!raw || raw === '[DONE]') continue
        try {
          const data = JSON.parse(raw) as { type?: string; content?: string; result?: { output?: Array<{ type: string; content?: string }> } }
          if (data.type === 'reasoning.delta' && typeof data.content === 'string') {
            hasReasoningDelta = true
            onThinking(data.content)
          } else if (data.type === 'message.delta' && typeof data.content === 'string') {
            if (hasReasoningDelta) {
              fullMessage += data.content
            } else {
              fullMessage += parseThinkBlocks(data.content, thinkState, onThinking)
            }
          } else if (data.type === 'chat.end' && data.result?.output) {
            fullMessage = ''
            for (const item of data.result.output) {
              if ((item.type === 'reasoning' || item.type === 'message') && item.content) {
                fullMessage += item.content
              }
            }
          }
        } catch {
          // skip malformed JSON
        }
      }
    }
  }
  if (!fullMessage && buffer) {
    try {
      for (const line of buffer.split('\n')) {
        if (line.startsWith('data: ')) {
          const raw = line.slice(6).trim()
          const data = JSON.parse(raw) as { type?: string; result?: { output?: Array<{ type: string; content?: string }> } }
          if (data.type === 'chat.end' && data.result?.output) {
            for (const item of data.result.output) {
              if ((item.type === 'reasoning' || item.type === 'message') && item.content) {
                fullMessage += item.content
              }
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }
  return fullMessage
}

/** Call LLM and return raw text response */
async function callLLM(
  model: AgentModel | string,
  systemMessage: string,
  userMessage: string,
  apiKeys?: { openai?: string; anthropic?: string; deepseek?: string },
  localMode?: boolean,
  onThinking?: (chunk: string) => void,
  signal?: AbortSignal,
  attempt?: number,
  images?: ImageAttachment[]
): Promise<string> {
  // Local Mode with streaming: LM Studio native API (or OpenAI-compatible when images present)
  if (localMode && onThinking) {
    return callLLMStreaming(model, systemMessage, userMessage, onThinking, signal, images)
  }
  // Local Mode (non-streaming): OpenAI-compatible API
  if (localMode) {
    const { apiBase, apiKey } = config.localAgent
    const url = `${apiBase}/chat/completions`
    const res = await fetch(url, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: getLocalModelId(model),
        max_tokens: 2048,
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: buildUserContentOpenAI(userMessage, images) },
        ],
      }),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Local API error: ${res.status} ${err}`)
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    return data.choices?.[0]?.message?.content ?? ''
  }

  const anthropicApiKey = apiKeys?.anthropic?.trim() || ''
  const openaiApiKey = apiKeys?.openai?.trim() || ''
  const deepseekApiKey = apiKeys?.deepseek?.trim() || ''

  if (model.startsWith('claude')) {
    if (!anthropicApiKey) throw new Error('API key required for Anthropic. Add your key in Agent Uplink.')
    const supportsThinking = /claude-(opus-4|sonnet-4|haiku-4|3-7-sonnet)/.test(model)
    if (onThinking) {
      return callAnthropicStreaming(anthropicApiKey, model, systemMessage, userMessage, onThinking, signal, supportsThinking, images)
    }
    const userContent = buildUserContent(userMessage, images)
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        system: buildAnthropicSystemWithCache(systemMessage),
        messages: [{ role: 'user', content: userContent }],
      }),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Anthropic API error: ${res.status} ${err}`)
    }
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> }
    const text = data.content?.find((c) => c.type === 'text')?.text ?? ''
    return text
  }

  if (model.startsWith('gpt') || model.startsWith('o1')) {
    if (!openaiApiKey) throw new Error('API key required for OpenAI. Add your key in Agent Uplink.')
    if (onThinking) {
      return callOpenAIStreaming(openaiApiKey, model, systemMessage, userMessage, onThinking, signal, images)
    }
    const userContent = buildUserContentOpenAI(userMessage, images)
    const body: Record<string, unknown> = {
      model,
      max_tokens: 2048,
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: userContent },
      ],
    }
    if (model.startsWith('o1')) {
      body.reasoning_effort = 'medium'
    }
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`OpenAI API error: ${res.status} ${err}`)
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const text = data.choices?.[0]?.message?.content ?? ''
    return text
  }

  if (model.startsWith('deepseek')) {
    if (!deepseekApiKey) throw new Error('API key required for DeepSeek. Add your key in Agent Uplink.')
    if (onThinking) {
      return callDeepSeekStreaming(deepseekApiKey, model, systemMessage, userMessage, onThinking, signal, attempt ?? 0, images)
    }
    const attemptNum = attempt ?? 0
    const maxTokens = Math.min(16384 * (1 << Math.min(attemptNum, 2)), 65536)
    const userContent = buildUserContentOpenAI(userMessage, images)
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${deepseekApiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: userContent },
        ],
      }),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`DeepSeek API error: ${res.status} ${err}`)
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>
    }
    // Use content only — ignore reasoning_content for transaction parsing (DeepSeek reasoning models)
    const msg = data.choices?.[0]?.message
    const content = msg?.content ?? ''
    return content
  }

  throw new Error(`Unknown model: ${model}`)
}

/** Trace optical stack (Pyodide or HTTP) and return result */
async function traceStack(optical_stack: {
  surfaces: Surface[]
  entrancePupilDiameter: number
  wavelengths: number[]
  fieldAngles: number[]
  numRays: number
  focusMode?: FocusMode
  m2Factor?: number
}) {
  return traceOpticalStack(optical_stack)
}

export type AgentRunOptions = {
  /** Cloud model ID or local model ID (exact LM Studio name when localMode) */
  model: AgentModel | string
  maxRetries?: number
  onProgress?: (msg: string) => void
  /** Runtime API keys from localStorage (UplinkModal) — required for LLM calls when not in localMode */
  apiKeys?: { openai?: string; anthropic?: string; deepseek?: string }
  /** Called when agent proposes a transaction (before validation) — for ghost preview */
  onProposal?: (surfaces: Surface[]) => void
  /** Local Mode: use LM Studio at localhost:1234/v1 with dummy key */
  localMode?: boolean
  /** Called with reasoning chunks in real time (LM Studio streaming only) */
  onThinking?: (chunk: string) => void
  /** Called at start of each attempt to clear previous thinking (when using onThinking) */
  onThinkingClear?: () => void
  /** AbortSignal to cancel the run (e.g. Stop button) */
  signal?: AbortSignal
  /** Image attachments for multimodal prompts (drop/paste into Command box) */
  images?: ImageAttachment[]
  /** Session for State-Diff (handshake once, delta thereafter). If omitted, uses full context every time. */
  session?: AgentSessionState
  /** Use hybrid model router (Brain-Body split). Default true. */
  useRouter?: boolean
  /** Called when Multi-Physics Auditor rejects design — for Physics Integrity UI */
  onPhysicsViolation?: (report: ValidationReport) => void
}

export type AgentRunResult =
  | { success: true; surfaces: Surface[]; transaction: AgentTransaction; traceResult: Awaited<ReturnType<typeof traceStack>> }
  | { success: false; error: string; lastTransaction?: AgentTransaction; localUnreachable?: boolean; aborted?: boolean }

/** Run the agent loop: prompt → LLM → parse → apply → validate → trace. Multi-Physics Auditor rejects physical invariant violations. */
export async function runAgent(
  state: SystemState,
  userPrompt: string,
  options: AgentRunOptions
): Promise<AgentRunResult> {
  const { model, maxRetries = 3, onProgress, onProposal, apiKeys, localMode, onThinking, onThinkingClear, signal, images, session, useRouter = true, onPhysicsViolation } = options

  const pruned = pruneSmallTalk(userPrompt)
  if (pruned === null) {
    const tr = state.traceResult ?? await traceStack({
      surfaces: state.surfaces,
      entrancePupilDiameter: state.entrancePupilDiameter,
      wavelengths: state.wavelengths,
      fieldAngles: state.fieldAngles,
      numRays: state.numRays,
    })
    return { success: true, surfaces: state.surfaces, transaction: { surfaceDeltas: [] }, traceResult: tr }
  }
  const effectivePrompt = pruned

  let routedModel = ROUTING_ENABLED && useRouter ? routeModel(effectivePrompt, model as AgentModel) : model
  if (routedModel !== model && !localMode && apiKeys && !hasKeyForModel(routedModel, apiKeys)) {
    routedModel = model
  }
  if (session) resetEpisodicGoal(session, effectivePrompt.slice(0, 120))

  const optical_stack = {
    surfaces: state.surfaces,
    entrancePupilDiameter: state.entrancePupilDiameter,
    wavelengths: state.wavelengths,
    fieldAngles: state.fieldAngles,
    numRays: state.numRays,
    focusMode: state.focusMode,
    m2Factor: state.m2Factor,
  }

  let surfaces = [...state.surfaces]
  let traceResult: Awaited<ReturnType<typeof traceStack>> | null = null
  let lastTransaction: AgentTransaction | null = null
  let lastError = ''

  // Proactive check: LM Studio logs "Model does not support images" but may not return it in the API response.
  // Query /api/v1/models for capabilities.vision to know for sure before sending.
  if (images?.length && localMode) {
    const modelId = getLocalModelId(routedModel)
    const visionSupport = await getLocalModelVisionSupport(modelId)
    if (visionSupport === false) {
      return {
        success: false,
        error: `The selected model (${modelId}) does not support images. Load a vision model (e.g. Qwen2-VL) in LM Studio or switch to Cloud API (GPT-4o, Claude).`,
      }
    }
  }

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    onThinkingClear?.()
    onProgress?.(attempt === 0 ? 'Thinking...' : `Retrying (${attempt + 1}/${maxRetries})...`)

    const currentTrace = traceResult ? { ...state.traceResult!, ...traceResult } as TraceResult : state.traceResult
    const opticalMeta = {
      entrancePupilDiameter: optical_stack.entrancePupilDiameter,
      wavelengths: optical_stack.wavelengths,
      fieldAngles: optical_stack.fieldAngles,
      numRays: optical_stack.numRays,
      focusMode: optical_stack.focusMode,
      m2Factor: optical_stack.m2Factor,
    }

    let systemMessage: string
    if (session) {
      const { delta, isHandshake } = getStateDelta(session, surfaces, currentTrace, opticalMeta)
      systemMessage = buildSystemMessageFromDelta(delta, isHandshake, session.episodic)
    } else {
      systemMessage = buildSystemMessage({ ...optical_stack, surfaces }, currentTrace)
    }

    const isParseError = lastError === 'Could not parse valid transaction from LLM response'
    const isPhysicalViolation = lastError.startsWith('Design rejected: Physical Invariant Violation')
    const errorContext = attempt > 0 && lastError
      ? isParseError
        ? `\n\nYour previous response was not valid JSON. Return ONLY a raw JSON object with "surfaceDeltas" (array) and optional "reasoning". No markdown, no \`\`\`json\`\`\` blocks, no text before or after. Example: {"surfaceDeltas":[{"id":"...","radius":50}],"reasoning":"..."}`
        : isPhysicalViolation
          ? `\n\nYour proposed design violates physical or manufacturing constraints. See the report below. You must adjust the parameters to satisfy these constraints before I can render the system.\n\n${lastError}`
          : `\n\nPrevious attempt failed: ${lastError}. Propose a different transaction to fix this.`
      : ''
    const imageSuffix = images?.length
      ? `\n\n[CRITICAL: Image(s) are attached. Analyze them and propose optical changes. Your response MUST be ONLY a valid JSON object with "surfaceDeltas" (array) and optional "reasoning". No conversational text, no markdown, no explanation before or after the JSON.]`
      : ''
    if (session && attempt > 0) updateEpisodic(session, { failedIterations: [isParseError ? 'Parse error (invalid JSON)' : lastError] })

    let text: string
    try {
      text = await callLLM(routedModel, systemMessage, effectivePrompt + imageSuffix + errorContext, apiKeys, localMode, onThinking, signal, attempt, images)
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError'
      let msg = err instanceof Error ? err.message : String(err)
      if (!aborted && images?.length && isVisionUnsupportedError(msg)) {
        msg = extractVisionErrorFromApi(msg)
      }
      const localUnreachable = !aborted && localMode && isLocalUnreachableError(err)
      return {
        success: false,
        error: aborted ? 'Stopped by user' : msg,
        lastTransaction: lastTransaction ?? undefined,
        localUnreachable,
        aborted,
      }
    }

    const parseOpts = localMode ? { model: routedModel, promptPreview: effectivePrompt, saveThoughts: true } : undefined
    const transaction = parseTransaction(text, surfaces, parseOpts)
    if (!transaction) {
      const modelRefusal = images?.length ? modelRefusesImages(text) : null
      lastError = modelRefusal
        ? `The model does not support images. It responded: "${modelRefusal}…" Try GPT-4o or Claude for image analysis.`
        : images?.length
          ? 'Could not parse valid transaction from LLM response. The model may not support images — try GPT-4o or Claude for image analysis.'
          : 'Could not parse valid transaction from LLM response'
      continue
    }

    if (transaction.physicsViolation) {
      lastError = [transaction.reason, transaction.suggestedAlternative].filter(Boolean).join('. ') || 'Agent flagged PHYSICS_VIOLATION'
      lastTransaction = transaction
      continue
    }

    // Accept empty surfaceDeltas as valid — agent determined no changes needed
    if (transaction.surfaceDeltas.length === 0) {
      const tr = traceResult ?? (await traceStack({ ...optical_stack, surfaces }))
      if (session) {
        updateSessionAfterRequest(session, surfaces, tr)
        updateEpisodic(session, { constraintsMet: ['No changes needed'] })
      }
      return { success: true, surfaces, transaction, traceResult: tr }
    }

    lastTransaction = transaction

    const validation = validateTransaction(surfaces, transaction)
    if (!validation.valid) {
      lastError = validation.error ?? 'Validation failed'
      continue
    }

    onProgress?.('Applying changes...')
    surfaces = applyTransaction(surfaces, transaction)
    onProposal?.(surfaces)

    onProgress?.('Validating with ray trace...')
    try {
      traceResult = await traceStack({
        ...optical_stack,
        surfaces,
      })
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      continue
    }

    /** Multi-Physics Auditor: validate physical invariants (geometry, material, energy, operational) */
    const audit = validatePhysicalState(surfaces, traceResult)

    if (!audit.isValid) {
      const violationList = audit.violations.map((v) => `[${v.category}] ${v.message}`).join('; ')
      lastError = `Design rejected: Physical Invariant Violation. ${violationList} Please resolve these constraints before proceeding.`
      onPhysicsViolation?.(audit)
      if (session) updateEpisodic(session, { failedIterations: audit.violations.map((v) => v.message) })
      continue
    }

    if (session) {
      updateSessionAfterRequest(session, surfaces, traceResult)
      updateEpisodic(session, { constraintsMet: ['All physical constraints satisfied'] })
    }
    return { success: true, surfaces, transaction, traceResult }
  }

  return {
    success: false,
    error: lastError || 'Agent did not converge',
    lastTransaction: lastTransaction ?? undefined,
  }
}
