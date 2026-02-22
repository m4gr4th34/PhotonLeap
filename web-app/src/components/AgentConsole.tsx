/**
 * LeapOS Agent Console — Command-deck UI for AI-driven optical design.
 * Natural-language prompts, model selector, context injection.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import ReactDOM from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, ChevronDown, ChevronRight, Loader2, CheckCircle, XCircle, KeyRound, Square, ImagePlus, X, Shield, ShieldAlert, RefreshCw } from 'lucide-react'
import { config } from '../config'
import type { SystemState } from '../types/system'
import type { AgentModel, AgentModelInfo, ImageAttachment } from '../types/agent'
import { runAgent, buildSystemMessage, type ValidationReport } from '../lib/agentOrchestrator'
import { createAgentSession } from '../lib/agentSession'
import { useAgents } from '../contexts/AgentKeysContext'
import { UplinkModal } from './UplinkModal'
import type { SemanticDelta } from '../lib/latticePhysics'

/** Agent Grid — role-based model recommendations for physics tasks */
const AGENT_MODELS: AgentModelInfo[] = [
  { id: 'claude-opus-4-5-20251101', name: 'Claude Opus 4.5', provider: 'anthropic', role: 'physicist', description: 'Master Consultant — highest reasoning ceiling' },
  { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'anthropic', role: 'physicist', description: 'The Physicist — Goldilocks for coding/math' },
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', role: 'visionary', description: 'The Visionary — multimodal, vision-to-physics' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', description: 'Lightweight' },
  { id: 'o1-2024-12-17', name: 'OpenAI o1', provider: 'openai', role: 'optimizer', description: 'The Optimizer — chain-of-thought reasoning' },
  { id: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'deepseek', description: 'DeepSeek' },
  { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', provider: 'deepseek', role: 'optimizer', description: 'Reasoning-heavy for quantum' },
]

function getApiKeyForModel(model: AgentModel, keys: { openai: string; anthropic: string; deepseek: string }): string | undefined {
  if (model.startsWith('claude')) return keys.anthropic?.trim() || undefined
  if (model.startsWith('gpt') || model.startsWith('o1')) return keys.openai?.trim() || undefined
  if (model.startsWith('deepseek')) return keys.deepseek?.trim() || undefined
  return undefined
}

type AgentConsoleProps = {
  systemState: SystemState
  onSystemStateChange: (state: SystemState | ((prev: SystemState) => SystemState)) => void
  /** Ghost surfaces for preview (Phase 3.2) — not used yet */
  ghostSurfaces?: SystemState['surfaces'] | null
  /** Recent semantic deltas from user edits (physical implications) — injected into prompt */
  recentSemanticDeltas?: SemanticDelta[]
  onClearSemanticDeltas?: () => void
}

export function AgentConsole({ systemState, onSystemStateChange, recentSemanticDeltas = [], onClearSemanticDeltas }: AgentConsoleProps) {
  const { keys, setKeys, clearAllKeys, localMode, setLocalMode, localModels, setLocalModels } = useAgents()
  const [uplinkOpen, setUplinkOpen] = useState(false)
  const [uplinkRequiredMessage, setUplinkRequiredMessage] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState<AgentModel>('claude-3-5-sonnet-20241022')
  const [localModel, setLocalModel] = useState<string>('')
  const [showContext, setShowContext] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<'success' | 'error' | null>(null)
  const [lastReasoning, setLastReasoning] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [thinkingStream, setThinkingStream] = useState<string>('')
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false)
  const [localOfflineWarning, setLocalOfflineWarning] = useState(false)
  const [commandHistory, setCommandHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [imageAttachments, setImageAttachments] = useState<ImageAttachment[]>([])
  const [imageError, setImageError] = useState<string | null>(null)
  const [physicsViolations, setPhysicsViolations] = useState<ValidationReport | null>(null)
  const [newSessionConfirmOpen, setNewSessionConfirmOpen] = useState(false)
  const [newSessionToast, setNewSessionToast] = useState(false)
  const [newSessionJustReset, setNewSessionJustReset] = useState(false)
  const draftRef = useRef('')
  const lastRunHadImagesRef = useRef(false)
  const modelDropdownRef = useRef<HTMLDivElement>(null)
  const thinkingContainerRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const sessionRef = useRef(createAgentSession())

  const MAX_COMMAND_HISTORY = 50
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']
const MAX_IMAGE_SIZE_MB = 5

function fileToImageAttachment(file: File): Promise<ImageAttachment> {
  return new Promise((resolve, reject) => {
    if (!IMAGE_TYPES.includes(file.type)) {
      reject(new Error(`Unsupported format: ${file.type}. Use PNG, JPEG, GIF, or WebP.`))
      return
    }
    if (file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
      reject(new Error(`Image too large (max ${MAX_IMAGE_SIZE_MB} MB).`))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
      if (!match) {
        reject(new Error('Failed to read image.'))
        return
      }
      resolve({ mediaType: match[1], data: match[2] })
    }
    reader.onerror = () => reject(new Error('Failed to read file.'))
    reader.readAsDataURL(file)
  })
}

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false)
      }
    }
    if (modelDropdownOpen) document.addEventListener('click', onOutside)
    return () => document.removeEventListener('click', onOutside)
  }, [modelDropdownOpen])

  // Auto-scroll thinking stream as it populates
  useEffect(() => {
    thinkingContainerRef.current?.scrollTo({ top: thinkingContainerRef.current.scrollHeight, behavior: 'smooth' })
  }, [thinkingStream])

  // When local models change: auto-select first if none selected, or reset if current was removed
  useEffect(() => {
    if (!localMode) return
    setLocalModel((prev) => {
      if (localModels.length === 0) return ''
      if (!prev || !localModels.includes(prev)) return localModels[0]
      return prev
    })
  }, [localMode, localModels])

  const optical_stack = {
    surfaces: systemState.surfaces,
    entrancePupilDiameter: systemState.entrancePupilDiameter,
    wavelengths: systemState.wavelengths,
    fieldAngles: systemState.fieldAngles,
    numRays: systemState.numRays,
    focusMode: systemState.focusMode,
    m2Factor: systemState.m2Factor,
  }
  const contextJson = buildSystemMessage(optical_stack, systemState.traceResult)

  const apiKey = getApiKeyForModel(model, keys)
  const hasApiKey = localMode ? localModels.length > 0 : Boolean(apiKey)
  const effectiveModel = localMode ? localModel : model

  const handleSend = useCallback(async () => {
    const cmd = prompt.trim()
    if (!cmd && !imageAttachments.length) return
    if (!hasApiKey) {
      if (localMode) {
        setUplinkRequiredMessage('Local Mode: Add at least one model name in Agent Uplink (Manage keys) to proceed.')
      } else {
        const modelName = AGENT_MODELS.find((m) => m.id === model)?.name ?? model
        setUplinkRequiredMessage(`Neural Link Required: Please provide an API key for ${modelName} to proceed.`)
      }
      setUplinkOpen(true)
      return
    }
    if (localMode && !localModel) {
      setUplinkRequiredMessage('Local Mode: Select a model from the dropdown, or add models in Agent Uplink.')
      setUplinkOpen(true)
      return
    }
    setProgress('Thinking...')
    setLastResult(null)
    setLastReasoning(null)
    setErrorMessage(null)
    setThinkingStream('')
    setLocalOfflineWarning(false)
    setImageError(null)
    setPhysicsViolations(null)
    const imagesToSend = [...imageAttachments]
    lastRunHadImagesRef.current = imagesToSend.length > 0
    setImageAttachments([])
    setPrompt('')
    draftRef.current = ''
    setHistoryIndex(-1)
    const historyEntry = cmd || (imagesToSend.length ? `[${imagesToSend.length} image(s) attached]` : '')
    setCommandHistory((prev) => {
      if (!historyEntry) return prev
      const next = [historyEntry, ...prev.filter((c) => c !== historyEntry)].slice(0, MAX_COMMAND_HISTORY)
      return next
    })

    const ac = new AbortController()
    abortControllerRef.current = ac

    const userPrompt =
      recentSemanticDeltas.length > 0
        ? `[Recent edits: ${recentSemanticDeltas.map((d) => d.physicalImplication).join('; ')}]\n\n${cmd}`
        : cmd || '(Please analyze the attached image(s).)'

    const result = await runAgent(systemState, userPrompt, {
      model: effectiveModel as AgentModel,
      maxRetries: 3,
      onProgress: setProgress,
      apiKeys: keys.openai || keys.anthropic || keys.deepseek ? keys : undefined,
      onProposal: (surfaces) => {
        onSystemStateChange((prev) => ({ ...prev, ghostSurfaces: surfaces }))
      },
      localMode,
      onThinking: (chunk) => setThinkingStream((prev) => prev + chunk),
      onThinkingClear: () => setThinkingStream(''),
      signal: ac.signal,
      session: sessionRef.current,
      useRouter: !localMode,
      images: imagesToSend.length ? imagesToSend : undefined,
      onPhysicsViolation: setPhysicsViolations,
    })

    abortControllerRef.current = null
    setProgress(null)
    setPhysicsViolations(null)

    if (result.success) {
      onClearSemanticDeltas?.()
      setLastResult('success')
      setLastReasoning(result.transaction.reasoning ?? null)
      const tr = result.traceResult
      onSystemStateChange((prev) => ({
        ...prev,
        surfaces: result.surfaces,
        ghostSurfaces: null,
        traceResult: tr
          ? {
              rays: tr.rays ?? prev.traceResult?.rays ?? [],
              surfaces: tr.surfaces ?? prev.traceResult?.surfaces ?? [],
              focusZ: tr.focusZ ?? prev.traceResult?.focusZ ?? 0,
              bestFocusZ: tr.bestFocusZ ?? prev.traceResult?.bestFocusZ,
              zOrigin: tr.zOrigin ?? prev.traceResult?.zOrigin,
              performance: tr.performance ?? prev.traceResult?.performance,
              metricsSweep: tr.metricsSweep ?? prev.traceResult?.metricsSweep,
              gaussianBeam: tr.gaussianBeam ?? prev.traceResult?.gaussianBeam,
            }
          : prev.traceResult,
        hasTraced: true,
        traceError: null,
        ...(tr?.performance
          ? {
              rmsSpotRadius: tr.performance.rmsSpotRadius,
              totalLength: tr.performance.totalLength,
              fNumber: tr.performance.fNumber,
            }
          : {}),
      }))
    } else {
      setLastResult('error')
      setErrorMessage(result.aborted ? 'Stopped by user' : result.error)
      if (result.localUnreachable) setLocalOfflineWarning(true)
      onSystemStateChange((prev) => ({ ...prev, ghostSurfaces: null }))
    }
  }, [prompt, imageAttachments, model, localModel, effectiveModel, hasApiKey, systemState, onSystemStateChange, keys, localMode, recentSemanticDeltas, onClearSemanticDeltas])

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort()
  }, [])

  const handleNewSessionClick = useCallback(() => {
    setNewSessionConfirmOpen(true)
  }, [])

  const handleNewSessionConfirm = useCallback(() => {
    sessionRef.current = createAgentSession()
    setNewSessionConfirmOpen(false)
    setNewSessionToast(true)
    setNewSessionJustReset(true)
  }, [])

  useEffect(() => {
    if (!newSessionToast) return
    const t = setTimeout(() => setNewSessionToast(false), config.toastDuration)
    return () => clearTimeout(t)
  }, [newSessionToast])

  useEffect(() => {
    if (!newSessionJustReset) return
    const t = setTimeout(() => setNewSessionJustReset(false), 1200)
    return () => clearTimeout(t)
  }, [newSessionJustReset])

  return (
    <div className="h-full flex flex-col bg-slate-900/50 rounded-lg border border-white/10 overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10">
        <h2 className="text-cyan-electric font-semibold text-lg">LeapOS Command Deck</h2>
        <p className="text-slate-400 text-sm mt-0.5">
          Describe your optical design intent. The agent will propose surface changes and validate via ray trace.
        </p>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Model selector — Cloud models vs Local models */}
        <div>
          <label className="block text-slate-400 text-xs font-medium mb-1.5">Model</label>
          <div className="relative" ref={modelDropdownRef}>
            {localMode ? (
              <>
                <button
                  type="button"
                  onClick={() => localModels.length > 0 && setModelDropdownOpen((o) => !o)}
                  disabled={localModels.length === 0}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-slate-200 text-sm hover:border-cyan-electric/30 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <span className="font-mono truncate">
                    {localModel || (localModels.length === 0 ? 'Add models in Uplink' : 'Select local model')}
                  </span>
                  <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${modelDropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                {modelDropdownOpen && localModels.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 py-1 bg-slate-800 border border-white/10 rounded-lg shadow-xl z-10 max-h-48 overflow-y-auto">
                    {localModels.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          setLocalModel(m)
                          setModelDropdownOpen(false)
                        }}
                        className={`w-full px-3 py-2 text-left text-sm font-mono hover:bg-white/5 transition-colors ${
                          localModel === m ? 'text-cyan-electric bg-white/5' : 'text-slate-300'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setModelDropdownOpen((o) => !o)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-slate-200 text-sm hover:border-cyan-electric/30 transition-colors"
                >
                  <span>{AGENT_MODELS.find((m) => m.id === model)?.name ?? model}</span>
                  <ChevronDown className={`w-4 h-4 transition-transform ${modelDropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                {modelDropdownOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 py-1 bg-slate-800 border border-white/10 rounded-lg shadow-xl z-10">
                    {AGENT_MODELS.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          setModel(m.id)
                          setModelDropdownOpen(false)
                        }}
                        className={`w-full px-3 py-2 text-left text-sm hover:bg-white/5 transition-colors ${
                          model === m.id ? 'text-cyan-electric bg-white/5' : 'text-slate-300'
                        }`}
                      >
                        <span className="font-medium">{m.name}</span>
                        {m.role && (
                          <span className="text-cyan-electric/70 text-xs ml-2">[{m.role}]</span>
                        )}
                        <span className="text-slate-500 text-xs ml-2 block mt-0.5">{m.description}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          {localMode && (
            <p className="text-cyan-electric/80 text-xs mt-1.5">
              Local Mode — LM Studio @ localhost:1234
            </p>
          )}
          {!hasApiKey && !localMode && (
            <p className="text-amber-500/90 text-xs mt-1.5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setUplinkRequiredMessage(null)
                  setUplinkOpen(true)
                }}
                className="inline-flex items-center gap-1 text-cyan-electric hover:underline"
              >
                <KeyRound className="w-3.5 h-3.5" />
                Configure Uplink
              </button>
              to add an API key
            </p>
          )}
          {(hasApiKey || localMode) && (
            <div className="flex items-center gap-3 mt-1">
              <button
                type="button"
                onClick={() => {
                  setUplinkRequiredMessage(null)
                  setUplinkOpen(true)
                }}
                className="text-slate-500 hover:text-cyan-electric text-xs flex items-center gap-1"
              >
                <KeyRound className="w-3 h-3" />
                {localMode ? 'Manage keys & models' : 'Manage keys'}
              </button>
              <button
                type="button"
                onClick={handleNewSessionClick}
                disabled={!!progress}
                className={`text-slate-500 hover:text-cyan-electric text-xs flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${newSessionJustReset ? 'text-cyan-electric' : ''}`}
                title="Start fresh — clear episodic memory and context"
              >
                <RefreshCw className={`w-3 h-3 ${newSessionJustReset ? 'animate-spin' : ''}`} />
                New Session
              </button>
            </div>
          )}
        </div>

        <UplinkModal
          open={uplinkOpen}
          onClose={() => {
            setUplinkOpen(false)
            setUplinkRequiredMessage(null)
          }}
          initialKeys={keys}
          onSyncKeys={(k) => setKeys(k)}
          onClearAllKeys={clearAllKeys}
          requiredMessage={uplinkRequiredMessage ?? undefined}
          localMode={localMode}
          onLocalModeChange={setLocalMode}
          localModels={localModels}
          onLocalModelsChange={setLocalModels}
        />

        {/* New Session confirmation modal */}
        {ReactDOM.createPortal(
          <AnimatePresence>
            {newSessionConfirmOpen && (
              <motion.div
                key="new-session-confirm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                onClick={(e) => e.target === e.currentTarget && setNewSessionConfirmOpen(false)}
                role="dialog"
                aria-modal="true"
                aria-labelledby="new-session-confirm-title"
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="w-full max-w-sm rounded-xl border border-slate-600/80 bg-slate-900/95 shadow-2xl backdrop-blur-xl p-4"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h3 id="new-session-confirm-title" className="text-lg font-semibold text-cyan-electric mb-2">
                    New Session
                  </h3>
                  <p className="text-slate-300 text-sm mb-4">
                    Are you sure you want to reset all context? The agent will forget previous goals, constraints, and failed attempts.
                  </p>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setNewSessionConfirmOpen(false)}
                      className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200 hover:bg-white/5 rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleNewSessionConfirm}
                      className="px-3 py-1.5 text-sm font-medium bg-cyan-electric/20 text-cyan-electric hover:bg-cyan-electric/30 rounded-lg transition-colors"
                    >
                      Reset
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}

        {/* New Session success toast */}
        {ReactDOM.createPortal(
          <AnimatePresence>
            {newSessionToast && (
              <motion.div
                key="new-session-toast"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-sm shadow-xl backdrop-blur-sm flex items-center gap-2"
                role="status"
                aria-live="polite"
              >
                <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                Session reset — context cleared
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}

        {/* Local Node Offline warning — offer to switch back to Cloud */}
        {localOfflineWarning && localMode && (
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex flex-col gap-2">
            <p className="text-amber-400/90 text-sm font-medium">Local Node Offline</p>
            <p className="text-slate-400 text-xs">
              Unable to reach LM Studio at localhost:1234. If LM Studio is running, enable CORS in its Developer tab (Server Settings → Enable CORS). Otherwise switch back to Cloud API?
            </p>
            <button
              type="button"
              onClick={() => {
                setLocalMode(false)
                setLocalOfflineWarning(false)
                setErrorMessage(null)
              }}
              className="self-start px-3 py-1.5 text-sm font-medium text-cyan-electric hover:bg-cyan-electric/10 rounded-lg transition-colors"
            >
              Switch to Cloud API
            </button>
          </div>
        )}

        {/* Recent commands — subtle, secondary to active input */}
        {commandHistory.length > 0 && (
          <div className="space-y-1">
            <label className="block text-slate-500/80 text-[10px] font-medium uppercase tracking-wider">Recent commands</label>
            <div className="space-y-0.5 max-h-20 overflow-y-auto">
              {commandHistory.slice(0, 5).map((cmd, i) => (
                <div
                  key={`${i}-${cmd.slice(0, 20)}`}
                  className="px-2.5 py-1.5 rounded-md bg-slate-800/40 border border-white/[0.04] text-slate-500 text-[11px] font-mono leading-relaxed truncate"
                  title={cmd}
                >
                  <span className="text-slate-600 mr-1.5">›</span>
                  {cmd.length > 80 ? `${cmd.slice(0, 80)}…` : cmd}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Command input — Up/Down for history, drop/paste images */}
        <div
          onDragOver={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setImageError(null)
            const files = Array.from(e.dataTransfer.files).filter((f) => IMAGE_TYPES.includes(f.type))
            if (files.length === 0 && e.dataTransfer.files.length > 0) {
              setImageError('Only PNG, JPEG, GIF, or WebP images are supported.')
              return
            }
            Promise.all(files.map((f) => fileToImageAttachment(f)))
              .then((attachments) => {
                setImageAttachments((prev) => [...prev, ...attachments].slice(0, 4))
              })
              .catch((err) => setImageError(err instanceof Error ? err.message : 'Failed to add images.'))
          }}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData?.files ?? []).filter((f) => IMAGE_TYPES.includes(f.type))
            if (files.length === 0) return
            e.preventDefault()
            setImageError(null)
            Promise.all(files.map((f) => fileToImageAttachment(f)))
              .then((attachments) => {
                setImageAttachments((prev) => [...prev, ...attachments].slice(0, 4))
              })
              .catch((err) => setImageError(err instanceof Error ? err.message : 'Failed to add images.'))
          }}
        >
          <label className="block text-slate-400 text-xs font-medium mb-1.5">Command</label>
          {imageAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {imageAttachments.map((img, i) => (
                <div key={i} className="relative group">
                  <img
                    src={`data:${img.mediaType};base64,${img.data}`}
                    alt=""
                    className="w-14 h-14 object-cover rounded-lg border border-white/10"
                  />
                  <button
                    type="button"
                    onClick={() => setImageAttachments((prev) => prev.filter((_, j) => j !== i))}
                    className="absolute -top-1 -right-1 w-5 h-5 flex items-center justify-center rounded-full bg-slate-800 border border-white/20 text-slate-400 hover:bg-amber-500/20 hover:text-amber-400 hover:border-amber-500/40 transition-colors"
                    aria-label="Remove image"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {imageError && (
            <p className="text-amber-500/90 text-xs mb-1.5">{imageError}</p>
          )}
          <textarea
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value)
              if (historyIndex >= 0) setHistoryIndex(-1)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (prompt.trim() || imageAttachments.length) handleSend()
                return
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                if (commandHistory.length === 0) return
                if (historyIndex === -1) draftRef.current = prompt
                const next = Math.min(historyIndex + 1, commandHistory.length - 1)
                setHistoryIndex(next)
                setPrompt(commandHistory[next])
                return
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                if (historyIndex <= -1) return
                const next = historyIndex - 1
                setHistoryIndex(next)
                setPrompt(next >= 0 ? commandHistory[next] : draftRef.current)
              }
            }}
            placeholder="e.g. Design a beam expander for 532nm laser, 50mm tube length — or drop/paste images"
            rows={4}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-slate-200 text-sm font-mono placeholder-slate-500 focus:outline-none focus:border-cyan-electric/50 focus:shadow-[0_0_8px_rgba(34,211,238,0.25)] resize-none"
          />
          {commandHistory.length > 0 && (
            <p className="text-slate-600/80 text-[10px] mt-1">↑↓ browse history</p>
          )}
          {imageAttachments.length > 0 && (
            <p className="text-slate-600/80 text-[10px] mt-1 flex items-center gap-1">
              <ImagePlus className="w-3 h-3" />
              Drop or paste images (max {MAX_IMAGE_SIZE_MB} MB each)
            </p>
          )}
        </div>

        {/* Context injection (collapsible) */}
        <div>
          <button
            type="button"
            onClick={() => setShowContext((c) => !c)}
            className="flex items-center gap-2 text-slate-400 text-xs font-medium hover:text-cyan-electric/80 transition-colors"
          >
            {showContext ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            System context (optical_stack + traceResult)
          </button>
          {showContext && (
            <pre className="mt-2 p-3 bg-black/30 border border-white/10 rounded-lg text-xs text-slate-400 font-mono overflow-auto max-h-48">
              {contextJson}
            </pre>
          )}
        </div>

        {/* Physics Integrity status — red when agent struggling with physical violations */}
        {progress && (
          <div
            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs font-medium ${
              physicsViolations
                ? 'bg-amber-500/10 border-amber-500/40 text-amber-400'
                : 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400/90'
            }`}
          >
            {physicsViolations ? (
              <>
                <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                <span>Physics Integrity: {physicsViolations.violations.length} constraint(s) violated — retrying</span>
              </>
            ) : (
              <>
                <Shield className="w-3.5 h-3.5 shrink-0" />
                <span>Physics Integrity: OK</span>
              </>
            )}
          </div>
        )}

        {/* Real-time thinking stream (LM Studio local mode) — subtle, secondary */}
        {thinkingStream && (
          <div className="p-2.5 rounded-lg bg-slate-800/50 border border-white/[0.06]">
            <p className="text-slate-500/90 text-[10px] font-medium uppercase tracking-wider mb-1">Thinking…</p>
            <div
              ref={thinkingContainerRef}
              className="text-slate-500/90 text-[11px] leading-relaxed whitespace-pre-wrap font-mono max-h-36 overflow-y-auto"
            >
              {thinkingStream}
            </div>
          </div>
        )}

        {/* Send / Stop buttons */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSend}
            disabled={(!prompt.trim() && !imageAttachments.length) || !!progress}
            className="flex items-center gap-2 px-4 py-2 bg-cyan-electric/20 text-cyan-electric rounded-lg font-medium text-sm hover:bg-cyan-electric/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {progress ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {progress}
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                Send
              </>
            )}
          </button>
          {progress && (
            <button
              type="button"
              onClick={handleStop}
              className="flex items-center gap-2 px-4 py-2 bg-amber-500/20 text-amber-400 rounded-lg font-medium text-sm hover:bg-amber-500/30 transition-colors"
            >
              <Square className="w-4 h-4 fill-current" />
              Stop
            </button>
          )}
          {lastResult === 'success' && (
            <span className="flex items-center gap-1.5 text-emerald-400 text-sm">
              <CheckCircle className="w-4 h-4" />
              Design applied
            </span>
          )}
          {lastResult === 'error' && (
            <span className="flex items-center gap-1.5 text-amber-500 text-sm">
              <XCircle className="w-4 h-4" />
              Failed
            </span>
          )}
        </div>

        {lastResult === 'success' && lastReasoning && (
          <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
            <p className="text-emerald-400/90 text-xs font-medium mb-1.5">Agent explanation</p>
            <p className="text-slate-300 text-sm leading-relaxed">{lastReasoning}</p>
          </div>
        )}

        {errorMessage && (
          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg space-y-2">
            <p className="text-amber-500/90 text-sm font-mono">{errorMessage}</p>
            {errorMessage === 'Could not parse valid transaction from LLM response' &&
              localMode &&
              lastRunHadImagesRef.current && (
                <p className="text-slate-400 text-xs">
                  Many local models don&apos;t support vision. For image analysis, try a cloud model like GPT-4o or Claude.
                </p>
              )}
          </div>
        )}
      </div>
    </div>
  )
}
