/**
 * Hybrid Model Router — Brain-Body Split.
 * Routes reasoning-heavy tasks to DeepSeek-Reasoner, simple edits to cheaper models.
 */

import type { AgentModel } from '../types/agent'

/** Keywords that indicate reasoning/optimization (use Reasoner). */
const REASONING_KEYWORDS = [
  'optimize', 'optimization', 'minimize', 'maximize', 'zero coma', 'zero spherical',
  'aberration', 'seidel', 'strehl', 'rms', 'best focus', 'optimise',
  'design a', 'design an', 'create a', 'create an', 'suggest', 'recommend',
  'improve', 'fix', 'correct', 'troubleshoot', 'analyze', 'analyse',
  'why', 'explain', 'how does', 'what if', 'compare',
]

/** Keywords that indicate simple parametric change (use Chat/Mini). */
const SIMPLE_KEYWORDS = [
  'thicker', 'thinner', 'make lens', 'change', 'set', 'update',
  'radius', 'thickness', 'diameter', 'material', 'glass',
  'lens 1', 'lens 2', 'surface 1', 'surface 2', 'first lens', 'second lens',
  'mm', 'millimeter',
]

/**
 * Classify user prompt and return recommended model.
 * Reasoning → DeepSeek-Reasoner (or o1). Simple → DeepSeek-Chat or GPT-4o-mini.
 */
export function routeModel(prompt: string, userSelectedModel: AgentModel): AgentModel {
  const lower = prompt.toLowerCase().trim()

  const hasReasoning = REASONING_KEYWORDS.some((k) => lower.includes(k))
  const hasSimple = SIMPLE_KEYWORDS.some((k) => lower.includes(k))

  if (hasReasoning && !hasSimple) {
    return 'deepseek-reasoner'
  }
  if (hasSimple && !hasReasoning) {
    return 'gpt-4o-mini'
  }
  if (hasSimple && hasReasoning) {
    return 'deepseek-reasoner'
  }

  return userSelectedModel
}

/** Whether routing is enabled (user can disable for explicit model control). */
export const ROUTING_ENABLED = true
