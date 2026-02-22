/**
 * LeapOS Agent Orchestrator — Physics-Agent Bridge (AgentBridge).
 * Agent-Agnostic: each agent receives a State Snapshot (JSON) and returns a Diff of proposed changes.
 * Plug in new models (Claude 4, GPT-5) without rebuilding — just add to AgentModel type.
 *
 * SECURITY: API keys are used ONLY for requests to official provider endpoints
 * (api.anthropic.com, api.openai.com, api.deepseek.com). Keys are never logged or sent elsewhere.
 */

import type { Surface, SystemState, TraceResult, FocusMode } from '../types/system'
import type { AgentTransaction, SurfaceDelta, AgentModel } from '../types/agent'
import { config } from '../config'
import { traceOpticalStack } from '../api/trace'
import type { AgentSessionState, EpisodicMemory } from './agentSession'
import { getStateDelta, updateSessionAfterRequest, updateEpisodic, resetEpisodicGoal, pruneSmallTalk } from './agentSession'
import { routeModel, ROUTING_ENABLED } from './agentRouter'

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

/** PhotonLeap Physicist System Identity — transforms general-purpose LLM into Optical & Quantum Architect */
const PHYSICIST_SYSTEM_PROMPT = `Role: You are the PhotonLeap Lead Physicist, an expert in classical ray optics, wave propagation, and quantum information science. Your goal is to design, optimize, and troubleshoot physical systems within the PhotonLeap environment.

## Core Competencies
- Geometric Optics: Expert in Snell's Law, the Lensmaker's Equation, and Seidel aberrations (Spherical, Coma, Astigmatism, Field Curvature, Distortion).
- Physical Optics: Mastery of Gaussian beam propagation (M² factors, beam waist, Rayleigh range) and diffraction limits.
- Quantum States: Expertise in polarization (Jones Calculus), photon entanglement, and Bloch sphere mapping.

## Operational Protocol
- Zero-Error Physics: Every design must respect the Law of Conservation of Energy and the Second Law of Thermodynamics. You cannot "create" light without a defined source.
- Metric-Driven Design: When asked to optimize, minimize the Root Mean Square (RMS) spot size or maximize the Strehl Ratio.
- Manufacturing Awareness: Favor "buildable" designs. Avoid center thicknesses <1mm or curvatures that create "knife-edges" on lens peripheries. |radius| must be >= diameter to avoid impossible curves.

## Optical Stack Schema (input context)
Each surface has:
- id (string, required): unique identifier — MUST match existing surface ids exactly
- type: "Glass" | "Air"
- radius (mm): curvature radius; positive = convex toward +z, negative = concave; 0 = flat
- thickness (mm): distance to next surface
- refractiveIndex: n at primary wavelength
- diameter (mm): clear aperture
- material (string): must be from glass library
- description, coating

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
- If design fails (RMS too high), you will receive error context; propose a new transaction.`

/** Physics Validator: intercepts AI-generated designs. If agent proposes lens violating Conservation of Energy
 * (e.g. gain without pump), or RMS exceeds threshold, feeds error back to agent for second pass. */

/** Build system message with current optical context (State Snapshot) */
export function buildSystemMessage(
  optical_stack: { surfaces: Surface[]; entrancePupilDiameter: number; wavelengths: number[]; fieldAngles: number[]; numRays: number; focusMode?: string; m2Factor?: number },
  traceResult: TraceResult | null
): string {
  const ctx = {
    optical_stack: {
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
      })),
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
  return `${PHYSICIST_SYSTEM_PROMPT}\n\n## Current System State (JSON)\n\`\`\`json\n${JSON.stringify(ctx, null, 2)}\n\`\`\``
}

/** Build system message from state delta (token-efficient: handshake once, then delta-only). */
export function buildSystemMessageFromDelta(
  delta: object,
  isHandshake: boolean,
  episodic: EpisodicMemory
): string {
  const episodicBlock =
    episodic.currentGoal || episodic.constraintsMet.length || episodic.failedIterations.length
      ? `\n## Episodic Memory\n- Current Goal: ${episodic.currentGoal || 'None'}\n- Constraints Met: ${episodic.constraintsMet.join('; ') || 'None'}\n- Failed Iterations: ${episodic.failedIterations.join('; ') || 'None'}`
      : ''
  const label = isHandshake ? 'Full Handshake (JSON)' : 'State Delta (compact)'
  return `${PHYSICIST_SYSTEM_PROMPT}${episodicBlock}\n\n## ${label}\n\`\`\`json\n${JSON.stringify(delta)}\n\`\`\``
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
      if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { surfaceDeltas?: unknown }).surfaceDeltas)) {
        const t = parsed as { surfaceDeltas: unknown[]; reasoning?: string; physicsViolation?: boolean; reason?: string; suggestedAlternative?: string }
        return {
          surfaceDeltas: t.surfaceDeltas.filter((d): d is SurfaceDelta =>
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

/** Stream Anthropic Messages API — thinking_delta or text_delta to onThinking, returns full text */
async function callAnthropicStreaming(
  apiKey: string,
  model: string,
  systemMessage: string,
  userMessage: string,
  onThinking: (chunk: string) => void,
  signal?: AbortSignal,
  enableThinking?: boolean
): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: 2048,
    stream: true,
    system: systemMessage,
    messages: [{ role: 'user', content: userMessage }],
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
  return fullText
}

/** Stream OpenAI Chat Completions — content delta to onThinking, returns full content */
async function callOpenAIStreaming(
  apiKey: string,
  model: string,
  systemMessage: string,
  userMessage: string,
  onThinking: (chunk: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: 2048,
    stream: true,
    messages: [
      { role: 'system', content: systemMessage },
      { role: 'user', content: userMessage },
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
  return fullContent
}

/** Stream DeepSeek Chat Completions — reasoning_content or content to onThinking */
async function callDeepSeekStreaming(
  apiKey: string,
  model: string,
  systemMessage: string,
  userMessage: string,
  onThinking: (chunk: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      stream: true,
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: userMessage },
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
  return fullContent
}

/** Stream LLM via LM Studio native API — emits reasoning in real time, returns full message text */
async function callLLMStreaming(
  model: AgentModel | string,
  systemMessage: string,
  userMessage: string,
  onThinking: (chunk: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const { apiKey } = config.localAgent
  const url = `${getLMStudioNativeBase()}/chat`
  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: getLocalModelId(model),
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
            onThinking(data.content)
          } else if (data.type === 'message.delta' && typeof data.content === 'string') {
            fullMessage += data.content
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
  signal?: AbortSignal
): Promise<string> {
  // Local Mode with streaming: LM Studio native API for real-time reasoning
  if (localMode && onThinking) {
    return callLLMStreaming(model, systemMessage, userMessage, onThinking, signal)
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
          { role: 'user', content: userMessage },
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
      return callAnthropicStreaming(anthropicApiKey, model, systemMessage, userMessage, onThinking, signal, supportsThinking)
    }
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
        system: systemMessage,
        messages: [{ role: 'user', content: userMessage }],
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
      return callOpenAIStreaming(openaiApiKey, model, systemMessage, userMessage, onThinking, signal)
    }
    const body: Record<string, unknown> = {
      model,
      max_tokens: 2048,
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: userMessage },
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
      return callDeepSeekStreaming(deepseekApiKey, model, systemMessage, userMessage, onThinking, signal)
    }
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${deepseekApiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: userMessage },
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
  /** Session for State-Diff (handshake once, delta thereafter). If omitted, uses full context every time. */
  session?: AgentSessionState
  /** Use hybrid model router (Brain-Body split). Default true. */
  useRouter?: boolean
}

export type AgentRunResult =
  | { success: true; surfaces: Surface[]; transaction: AgentTransaction; traceResult: Awaited<ReturnType<typeof traceStack>> }
  | { success: false; error: string; lastTransaction?: AgentTransaction; localUnreachable?: boolean; aborted?: boolean }

/** Run the agent loop: prompt → LLM → parse → apply → validate → trace. Self-correct if RMS too high. */
export async function runAgent(
  state: SystemState,
  userPrompt: string,
  options: AgentRunOptions
): Promise<AgentRunResult> {
  const { model, maxRetries = 3, onProgress, onProposal, apiKeys, localMode, onThinking, onThinkingClear, signal, session, useRouter = true } = options
  const rmsThresholdUm = config.agentRmsThresholdUm

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

    const errorContext =
      attempt > 0 && lastError
        ? `\n\nPrevious attempt failed: ${lastError}. Propose a different transaction to fix this.`
        : ''
    if (session && attempt > 0) updateEpisodic(session, { failedIterations: [lastError] })

    let text: string
    try {
      text = await callLLM(routedModel, systemMessage, effectivePrompt + errorContext, apiKeys, localMode, onThinking, signal)
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError'
      const msg = err instanceof Error ? err.message : String(err)
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
      lastError = 'Could not parse valid transaction from LLM response'
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

    const rmsUm = traceResult?.performance?.rmsSpotRadius != null
      ? traceResult.performance.rmsSpotRadius * 1000
      : 0

    if (rmsUm <= rmsThresholdUm) {
      if (session) {
        updateSessionAfterRequest(session, surfaces, traceResult)
        updateEpisodic(session, { constraintsMet: [`RMS ${rmsUm.toFixed(1)} μm within threshold`] })
      }
      return { success: true, surfaces, transaction, traceResult }
    }

    lastError = `Design failed: RMS spot radius ${rmsUm.toFixed(1)} μm exceeds threshold ${rmsThresholdUm} μm. Try aspheric on Surface 2, different glass, or adjust curvature.`
  }

  return {
    success: false,
    error: lastError || 'Agent did not converge',
    lastTransaction: lastTransaction ?? undefined,
  }
}
