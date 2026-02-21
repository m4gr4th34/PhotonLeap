/**
 * Agent Uplink Modal — Futuristic API key configuration.
 * Glassmorphism style, cyberpunk typography, status glow, scanline animation.
 */

import { useState, useCallback, useEffect } from 'react'
import { X, Link2, Eye, EyeOff, Trash2 } from 'lucide-react'

const PROVIDERS = [
  {
    id: 'openai',
    label: 'OpenAI (GPT-4o / o1)',
    placeholder: 'sk-...',
    dashboardUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude 3.5 / Opus)',
    placeholder: 'sk-ant-...',
    dashboardUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    placeholder: 'sk-...',
    dashboardUrl: 'https://platform.deepseek.com/api_keys',
  },
] as const

type ProviderId = (typeof PROVIDERS)[number]['id']

type UplinkModalProps = {
  open: boolean
  onClose: () => void
  /** Initial keys from localStorage */
  initialKeys?: Partial<Record<ProviderId, string>>
  /** Called when user syncs keys — parent persists to localStorage */
  onSyncKeys?: (keys: Record<ProviderId, string>) => void
  /** Called when user clears all keys — wipes localStorage for security-conscious users */
  onClearAllKeys?: () => void
  /** Shown when modal opened because key was required (e.g. "Neural Link Required: Please provide an API key for [Model] to proceed.") */
  requiredMessage?: string
}

export function UplinkModal({ open, onClose, initialKeys = {}, onSyncKeys, onClearAllKeys, requiredMessage }: UplinkModalProps) {
  const [keys, setKeys] = useState<Record<ProviderId, string>>({
    openai: initialKeys.openai ?? '',
    anthropic: initialKeys.anthropic ?? '',
    deepseek: initialKeys.deepseek ?? '',
  })
  const [hidden, setHidden] = useState<Record<ProviderId, boolean>>({
    openai: true,
    anthropic: true,
    deepseek: true,
  })
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    if (open) {
      setKeys({
        openai: initialKeys.openai ?? '',
        anthropic: initialKeys.anthropic ?? '',
        deepseek: initialKeys.deepseek ?? '',
      })
    }
  }, [open, initialKeys.openai, initialKeys.anthropic, initialKeys.deepseek])

  const handleKeyChange = useCallback((id: ProviderId, value: string) => {
    setKeys((prev) => ({ ...prev, [id]: value }))
  }, [])

  const toggleHidden = useCallback((id: ProviderId) => {
    setHidden((prev) => ({ ...prev, [id]: !prev[id] }))
  }, [])

  const handleSync = useCallback(async () => {
    setSyncing(true)
    await new Promise((r) => setTimeout(r, 600))
    onSyncKeys?.(keys)
    setSyncing(false)
    onClose()
  }, [keys, onSyncKeys, onClose])

  const handleClearAll = useCallback(() => {
    setKeys({ openai: '', anthropic: '', deepseek: '' })
    onClearAllKeys?.()
    onClose()
  }, [onClearAllKeys, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />

      {/* Modal */}
      <div
        className="relative w-full max-w-md rounded-2xl border border-white/20 bg-white/5 shadow-2xl"
        style={{
          background: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 50%, rgba(34,211,238,0.03) 100%)',
          boxShadow: '0 0 40px rgba(34, 211, 238, 0.08), inset 0 1px 0 rgba(255,255,255,0.1)',
        }}
      >
        {/* Scanline overlay */}
        <div
          className="pointer-events-none absolute inset-0 rounded-2xl overflow-hidden opacity-[0.03]"
          style={{
            background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.3) 2px, rgba(0,0,0,0.3) 4px)',
          }}
        />

        <div className="relative p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2
              className="text-xl font-bold tracking-widest uppercase text-cyan-electric"
              style={{ fontFamily: "'Orbitron', 'Rajdhani', monospace" }}
            >
              Agent Uplink
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {requiredMessage && (
            <p className="text-amber-400/90 text-sm mb-4 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
              {requiredMessage}
            </p>
          )}
          <p className="text-slate-400 text-sm mb-6">
            Configure API keys for LeapOS agents. Keys are stored locally and never sent except to the respective provider.
          </p>

          {/* Key rows */}
          <div className="space-y-4">
            {PROVIDERS.map(({ id, label, placeholder, dashboardUrl }) => (
              <div
                key={id}
                className="flex items-center gap-3 p-3 rounded-xl border border-white/10 bg-black/20"
              >
                {/* Status glow */}
                <div
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    keys[id]?.trim() ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]' : 'bg-slate-500'
                  }`}
                />

                <div className="flex-1 min-w-0">
                  <label className="block text-xs text-slate-400 mb-1">{label}</label>
                  <div className="relative flex items-center gap-2">
                    <input
                      type={hidden[id] ? 'password' : 'text'}
                      value={keys[id]}
                      onChange={(e) => handleKeyChange(id, e.target.value)}
                      placeholder={placeholder}
                      className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-electric/50 focus:ring-1 focus:ring-cyan-electric/30 font-mono text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => toggleHidden(id)}
                      className="p-2 rounded-lg text-slate-400 hover:text-cyan-electric transition-colors shrink-0"
                      aria-label={hidden[id] ? 'Show key' : 'Hide key'}
                    >
                      {hidden[id] ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </button>
                    <a
                      href={dashboardUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 rounded-lg text-slate-400 hover:text-cyan-electric transition-colors shrink-0"
                      aria-label={`Open ${label} dashboard`}
                    >
                      <Link2 className="w-4 h-4" />
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Sync button with scanline effect */}
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="mt-6 w-full py-3 rounded-xl font-semibold tracking-wider uppercase text-cyan-electric border border-cyan-electric/50 bg-cyan-electric/10 hover:bg-cyan-electric/20 disabled:opacity-50 transition-all relative overflow-hidden uplink-sync-btn"
            style={{ fontFamily: "'Orbitron', 'Rajdhani', monospace" }}
          >
            <div
              className="absolute inset-0 pointer-events-none uplink-scanline"
              aria-hidden
            />
            <span className="relative">{syncing ? 'Syncing...' : 'Sync Keys'}</span>
          </button>

          {/* Clear All Keys — security-conscious users */}
          {onClearAllKeys && (
            <button
              type="button"
              onClick={handleClearAll}
              className="mt-3 w-full py-2 rounded-xl font-medium text-sm text-slate-400 hover:text-amber-400 hover:bg-amber-500/10 border border-transparent hover:border-amber-500/30 transition-all flex items-center justify-center gap-2"
              style={{ fontFamily: "'Orbitron', 'Rajdhani', monospace" }}
            >
              <Trash2 className="w-4 h-4" />
              Clear All Keys
            </button>
          )}
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;600;700&display=swap');
        .uplink-scanline {
          background: repeating-linear-gradient(
            0deg,
            transparent 0px,
            transparent 3px,
            rgba(34, 211, 238, 0.08) 3px,
            rgba(34, 211, 238, 0.08) 4px
          );
          animation: uplink-scanline 2s linear infinite;
          opacity: 0.8;
        }
        .uplink-sync-btn:hover .uplink-scanline,
        .uplink-sync-btn:focus .uplink-scanline {
          animation-duration: 1s;
          opacity: 1;
        }
        @keyframes uplink-scanline {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(100%); }
        }
      `}</style>
    </div>
  )
}
