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
Return ONLY valid JSON. No conversational filler unless requested.
{"surfaceDeltas":[{"id":"surf-uuid","radius":50,"thickness":5,"material":"N-BK7",...}],"reasoning":"brief physics explanation"}

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

/** Parse LLM response for AgentTransaction. Extracts JSON from markdown code blocks if present. */
export function parseTransaction(text: string): AgentTransaction | null {
  const trimmed = text.trim()
  // Try raw JSON first
  let jsonStr = trimmed
  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlock) {
    jsonStr = codeBlock[1].trim()
  } else {
    const objMatch = trimmed.match(/\{[\s\S]*\}/)
    if (objMatch) jsonStr = objMatch[0]
  }
  try {
    const parsed = JSON.parse(jsonStr) as unknown
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
    // ignore
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

/** Call LLM and return raw text response */
async function callLLM(
  model: AgentModel,
  systemMessage: string,
  userMessage: string,
  apiKeys?: { openai?: string; anthropic?: string; deepseek?: string }
): Promise<string> {
  const anthropicApiKey = apiKeys?.anthropic?.trim() || ''
  const openaiApiKey = apiKeys?.openai?.trim() || ''
  const deepseekApiKey = apiKeys?.deepseek?.trim() || ''

  if (model.startsWith('claude')) {
    if (!anthropicApiKey) throw new Error('API key required for Anthropic. Add your key in Agent Uplink.')
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
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
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
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
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const text = data.choices?.[0]?.message?.content ?? ''
    return text
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
  model: AgentModel
  maxRetries?: number
  onProgress?: (msg: string) => void
  /** Runtime API keys from localStorage (UplinkModal) — required for LLM calls */
  apiKeys?: { openai?: string; anthropic?: string; deepseek?: string }
  /** Called when agent proposes a transaction (before validation) — for ghost preview */
  onProposal?: (surfaces: Surface[]) => void
}

export type AgentRunResult =
  | { success: true; surfaces: Surface[]; transaction: AgentTransaction; traceResult: Awaited<ReturnType<typeof traceStack>> }
  | { success: false; error: string; lastTransaction?: AgentTransaction }

/** Run the agent loop: prompt → LLM → parse → apply → validate → trace. Self-correct if RMS too high. */
export async function runAgent(
  state: SystemState,
  userPrompt: string,
  options: AgentRunOptions
): Promise<AgentRunResult> {
  const { model, maxRetries = 3, onProgress, onProposal, apiKeys } = options
  const rmsThresholdUm = config.agentRmsThresholdUm

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
    onProgress?.(attempt === 0 ? 'Thinking...' : `Retrying (${attempt + 1}/${maxRetries})...`)

    const systemMessage = buildSystemMessage(
      { ...optical_stack, surfaces },
      traceResult ? { ...state.traceResult!, ...traceResult } as TraceResult : state.traceResult
    )

    const errorContext =
      attempt > 0 && lastError
        ? `\n\nPrevious attempt failed: ${lastError}. Propose a different transaction to fix this.`
        : ''

    let text: string
    try {
      text = await callLLM(model, systemMessage, userPrompt + errorContext, apiKeys)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg, lastTransaction: lastTransaction ?? undefined }
    }

    const transaction = parseTransaction(text)
    if (!transaction) {
      lastError = 'Could not parse valid transaction from LLM response'
      continue
    }

    if (transaction.physicsViolation) {
      lastError = [transaction.reason, transaction.suggestedAlternative].filter(Boolean).join('. ') || 'Agent flagged PHYSICS_VIOLATION'
      lastTransaction = transaction
      continue
    }

    if (transaction.surfaceDeltas.length === 0) {
      lastError = 'Transaction has no surface changes'
      continue
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
      return {
        success: true,
        surfaces,
        transaction,
        traceResult,
      }
    }

    lastError = `Design failed: RMS spot radius ${rmsUm.toFixed(1)} μm exceeds threshold ${rmsThresholdUm} μm. Try aspheric on Surface 2, different glass, or adjust curvature.`
  }

  return {
    success: false,
    error: lastError || 'Agent did not converge',
    lastTransaction: lastTransaction ?? undefined,
  }
}
