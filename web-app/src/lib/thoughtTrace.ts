/**
 * Invisible Thinking Logs — capture <think> blocks for debugging.
 * Raw thoughts are saved to a buffer (not re-sent to context).
 * In browser: accumulates in memory; can be exported via debug UI.
 */

export type ThoughtTraceEntry = {
  timestamp: string
  model: string
  promptPreview: string
  rawThought: string
}

const buffer: ThoughtTraceEntry[] = []
const MAX_ENTRIES = 100

export function appendThoughtTrace(model: string, promptPreview: string, rawThought: string): void {
  if (!rawThought.trim()) return
  buffer.push({
    timestamp: new Date().toISOString(),
    model,
    promptPreview: promptPreview.slice(0, 80),
    rawThought,
  })
  if (buffer.length > MAX_ENTRIES) buffer.shift()
}

export function getThoughtTraceLog(): string {
  return buffer
    .map(
      (e) =>
        `[${e.timestamp}] ${e.model}\nPrompt: ${e.promptPreview}\n---\n${e.rawThought}\n---\n`
    )
    .join('\n')
}

export function clearThoughtTrace(): void {
  buffer.length = 0
}

/** For debugging: expose in dev tools */
if (typeof window !== 'undefined') {
  ;(window as unknown as { __thoughtTrace?: { get: () => string; clear: () => void } }).__thoughtTrace = {
    get: getThoughtTraceLog,
    clear: clearThoughtTrace,
  }
}
