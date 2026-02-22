/**
 * Runtime API keys for LeapOS agents.
 * Overrides config.llm when keys are set via UplinkModal.
 *
 * SECURITY: API keys are NEVER logged to console or sent to any backend
 * other than the official AI provider endpoints (api.openai.com, api.anthropic.com, api.deepseek.com).
 */

import { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react'

export const STORAGE_KEY = 'photonleap_agent_keys'
export const LOCAL_MODE_STORAGE_KEY = 'photonleap_agent_local_mode'
export const LOCAL_MODELS_STORAGE_KEY = 'photonleap_agent_local_models'

export type AgentKeys = {
  openai: string
  anthropic: string
  deepseek: string
}

const emptyKeys: AgentKeys = {
  openai: '',
  anthropic: '',
  deepseek: '',
}

function loadStoredKeys(): AgentKeys {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyKeys
    const parsed = JSON.parse(raw) as Partial<AgentKeys>
    return {
      openai: parsed.openai ?? '',
      anthropic: parsed.anthropic ?? '',
      deepseek: parsed.deepseek ?? '',
    }
  } catch {
    return emptyKeys
  }
}

export type HasKeys = {
  openai: boolean
  anthropic: boolean
  deepseek: boolean
}

function loadLocalMode(): boolean {
  try {
    const raw = localStorage.getItem(LOCAL_MODE_STORAGE_KEY)
    return raw === 'true'
  } catch {
    return false
  }
}

function loadLocalModels(): string[] {
  try {
    const raw = localStorage.getItem(LOCAL_MODELS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((m): m is string => typeof m === 'string' && m.trim().length > 0) : []
  } catch {
    return []
  }
}

type AgentKeysContextValue = {
  keys: AgentKeys
  setKeys: (keys: AgentKeys) => void
  clearAllKeys: () => void
  getKey: (provider: keyof AgentKeys) => string
  localMode: boolean
  setLocalMode: (on: boolean) => void
  localModels: string[]
  setLocalModels: (models: string[]) => void
}

const AgentKeysContext = createContext<AgentKeysContextValue | null>(null)

export function AgentKeysProvider({ children }: { children: React.ReactNode }) {
  const [keys, setKeysState] = useState<AgentKeys>(loadStoredKeys)
  const [localMode, setLocalModeState] = useState(loadLocalMode)
  const [localModels, setLocalModelsState] = useState<string[]>(loadLocalModels)

  useEffect(() => {
    setKeysState(loadStoredKeys())
    setLocalModeState(loadLocalMode())
    setLocalModelsState(loadLocalModels())
  }, [])

  const setKeys = useCallback((newKeys: AgentKeys) => {
    setKeysState(newKeys)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newKeys))
    } catch {
      // ignore
    }
  }, [])

  const clearAllKeys = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
    setKeysState({ openai: '', anthropic: '', deepseek: '' })
  }, [])

  const getKey = useCallback(
    (provider: keyof AgentKeys) => keys[provider] || '',
    [keys]
  )

  const setLocalMode = useCallback((on: boolean) => {
    setLocalModeState(on)
    try {
      localStorage.setItem(LOCAL_MODE_STORAGE_KEY, String(on))
    } catch {
      // ignore
    }
  }, [])

  const setLocalModels = useCallback((models: string[]) => {
    const trimmed = models.map((m) => m.trim()).filter(Boolean)
    setLocalModelsState(trimmed)
    try {
      localStorage.setItem(LOCAL_MODELS_STORAGE_KEY, JSON.stringify(trimmed))
    } catch {
      // ignore
    }
  }, [])

  const value = useMemo(
    () => ({ keys, setKeys, clearAllKeys, getKey, localMode, setLocalMode, localModels, setLocalModels }),
    [keys, setKeys, clearAllKeys, getKey, localMode, setLocalMode, localModels, setLocalModels]
  )

  return (
    <AgentKeysContext.Provider value={value}>
      {children}
    </AgentKeysContext.Provider>
  )
}

function computeHasKeys(keys: AgentKeys): HasKeys {
  return {
    openai: Boolean(keys.openai?.trim()),
    anthropic: Boolean(keys.anthropic?.trim()),
    deepseek: Boolean(keys.deepseek?.trim()),
  }
}

/** Primary hook: keys, hasKeys per provider, setKeys, clearAllKeys. Keys are never logged. */
export function useAgents() {
  const ctx = useContext(AgentKeysContext)
  if (!ctx) {
    return {
      keys: emptyKeys,
      hasKeys: computeHasKeys(emptyKeys),
      setKeys: () => {},
      clearAllKeys: () => {},
      getKey: (_p: keyof AgentKeys) => '',
      localMode: false,
      setLocalMode: () => {},
      localModels: [] as string[],
      setLocalModels: () => {},
    }
  }
  const hasKeys = useMemo(() => computeHasKeys(ctx.keys), [ctx.keys])
  return {
    keys: ctx.keys,
    hasKeys,
    setKeys: ctx.setKeys,
    clearAllKeys: ctx.clearAllKeys,
    getKey: ctx.getKey,
    localMode: ctx.localMode,
    setLocalMode: ctx.setLocalMode,
    localModels: ctx.localModels,
    setLocalModels: ctx.setLocalModels,
  }
}

/** @deprecated Use useAgents instead. Kept for backward compatibility. */
export function useAgentKeys() {
  const { keys, setKeys, getKey } = useAgents()
  return { keys, setKeys, getKey }
}
