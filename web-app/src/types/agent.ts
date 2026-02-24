/**
 * LeapOS Agent types — AI-Agent-Centric physics platform.
 * AgentBridge: State Snapshot → Diff (Transaction).
 */

/** State Snapshot — JSON passed to agent. Each agent receives this and returns a Diff. */
export type AgentStateSnapshot = {
  optical_stack: unknown
  traceResult: unknown
  consoleErrors?: string[]
}

/** Diff — proposed changes returned by agent. Applied by Physics Validator. */
export type AgentDiff = AgentTransaction

/** AgentBridge contract: toggle between models; each receives State Snapshot, returns Diff */
export type AgentBridgeCall = (
  model: AgentModel,
  stateSnapshot: AgentStateSnapshot,
  userPrompt: string
) => Promise<AgentDiff | null>

/** Partial surface update — only specified fields are applied */
export type SurfaceDelta = {
  id: string
  /** When true, remove this surface from the stack */
  _delete?: boolean
  semanticName?: string
  aiContext?: string
  radius?: number
  thickness?: number
  refractiveIndex?: number
  diameter?: number
  material?: string
  description?: string
  type?: 'Glass' | 'Air'
  coating?: string
  sellmeierCoefficients?: { B: number[]; C: number[] }
}

/** Custom material when library glass is insufficient (Material Synthesis) */
export type CustomMaterial = {
  refractive_index: number
  abbe_number: number
  reasoning: string
}

/** Transaction returned by the LLM — set of surface changes to apply */
export type AgentTransaction = {
  surfaceDeltas: SurfaceDelta[]
  /** Custom material when library cannot satisfy chromatic requirements */
  custom_material?: CustomMaterial
  /** Optional reasoning from the agent */
  reasoning?: string
  /** Agent self-flagged: design is physically impossible (e.g. TIR) */
  physicsViolation?: boolean
  /** When physicsViolation: human-readable reason */
  reason?: string
  /** When physicsViolation: suggested alternative geometry */
  suggestedAlternative?: string
}

/** Supported LLM models — Agent-Agnostic: plug in new models without rebuilding */
export type AgentModel =
  | 'claude-opus-4-5-20251101'    // Master Consultant (Opus 4.5)
  | 'claude-3-5-sonnet-20241022'
  | 'gpt-4o'
  | 'gpt-4o-mini'
  | 'o1-2024-12-17'
  | 'deepseek-chat'
  | 'deepseek-reasoner'

/** Image attachment for multimodal prompts — base64 data + media type */
export type ImageAttachment = {
  data: string
  mediaType: string
}

/** Agent role for task assignment (Agent Grid) */
export type AgentRole =
  | 'physicist'   // Snell's Law, quantum propagation math
  | 'optimizer'   // Iterative optimization, 10k+ runs
  | 'visionary'   // Vision-to-physics, photo/sketch analysis
  | 'architect'   // High-level refactoring (Composer-ready structure)

/** Agent run state for UI */
export type AgentRunState =
  | { status: 'idle' }
  | { status: 'thinking'; message?: string }
  | { status: 'applying'; transaction: AgentTransaction }
  | { status: 'validating' }
  | { status: 'success'; message?: string }
  | { status: 'error'; message: string }
  | { status: 'retry'; attempt: number; lastError: string }

/** Model metadata for the selector — Agent Grid: role + recommendation */
export type AgentModelInfo = {
  id: AgentModel
  name: string
  provider: 'anthropic' | 'openai' | 'deepseek'
  role?: AgentRole
  description?: string
}
