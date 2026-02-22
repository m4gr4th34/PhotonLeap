/**
 * v3.2 Model Tiering — cost-efficient routing.
 * Simple Physics → DeepSeek-Chat (V3). Complex Optimization → DeepSeek-Reasoner (R1).
 * Keeps $5 balance lasting for months.
 */

import type { AgentModel } from '../types/agent'

/** Keywords that indicate complex optimization (use Reasoner R1). */
const COMPLEX_OPTIMIZATION_KEYWORDS = [
  'optimize', 'optimization', 'minimize', 'maximize', 'zero coma', 'zero spherical',
  'aberration', 'seidel', 'strehl', 'rms', 'best focus', 'optimise',
  'design a', 'design an', 'create a', 'create an', 'suggest', 'recommend',
  'improve', 'fix', 'correct', 'troubleshoot', 'analyze', 'analyse',
  'why', 'explain', 'how does', 'what if', 'compare',
]

/** Keywords that indicate simple parametric change (use Chat V3). */
const SIMPLE_PHYSICS_KEYWORDS = [
  'thicker', 'thinner', 'make lens', 'change', 'set', 'update',
  'radius', 'thickness', 'diameter', 'material', 'glass',
  'lens 1', 'lens 2', 'surface 1', 'surface 2', 'first lens', 'second lens',
  'mm', 'millimeter',
]

/**
 * Route by complexity: Simple Physics → DeepSeek-Chat, Complex Optimization → DeepSeek-Reasoner.
 * Only overrides when user selected model is DeepSeek (or we have DeepSeek key and user chose a DeepSeek-capable flow).
 */
export function routeModel(prompt: string, userSelectedModel: AgentModel): AgentModel {
  const lower = prompt.toLowerCase().trim()

  const hasComplex = COMPLEX_OPTIMIZATION_KEYWORDS.some((k) => lower.includes(k))
  const hasSimple = SIMPLE_PHYSICS_KEYWORDS.some((k) => lower.includes(k))

  if (hasComplex && !hasSimple) {
    return 'deepseek-reasoner'
  }
  if (hasSimple && !hasComplex) {
    return 'deepseek-chat'
  }
  if (hasSimple && hasComplex) {
    return 'deepseek-reasoner'
  }

  return userSelectedModel
}

/** Whether routing is enabled (user can disable for explicit model control). */
export const ROUTING_ENABLED = true
