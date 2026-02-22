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

type AgentKeysContextValue = {
  keys: AgentKeys
  setKeys: (keys: AgentKeys) => void
  clearAllKeys: () => void
  getKey: (provider: keyof AgentKeys) => string
  localMode: boolean
  setLocalMode: (on: boolean) => void
}

const AgentKeysContext = createContext<AgentKeysContextValue | null>(null)

export function AgentKeysProvider({ children }: { children: React.ReactNode }) {
  const [keys, setKeysState] = useState<AgentKeys>(loadStoredKeys)
  const [localMode, setLocalModeState] = useState(loadLocalMode)

  useEffect(() => {
    setKeysState(loadStoredKeys())
    setLocalModeState(loadLocalMode())
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

  const value = useMemo(
    () => ({ keys, setKeys, clearAllKeys, getKey, localMode, setLocalMode }),
    [keys, setKeys, clearAllKeys, getKey, localMode, setLocalMode]
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
  }
}

/** @deprecated Use useAgents instead. Kept for backward compatibility. */
export function useAgentKeys() {
  const { keys, setKeys, getKey } = useAgents()
  return { keys, setKeys, getKey }
}
