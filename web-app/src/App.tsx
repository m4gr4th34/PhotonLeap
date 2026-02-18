import { useState, useCallback } from 'react'
import { NavBar } from './components/NavBar'
import { Canvas } from './components/Canvas'
import { SystemProperties } from './components/SystemProperties'
import {
  DEFAULT_SYSTEM_STATE,
  computePerformance,
  type SystemState,
} from './types/system'

function App() {
  const [systemState, setSystemState] = useState<SystemState>(() => ({
    ...DEFAULT_SYSTEM_STATE,
    ...computePerformance(DEFAULT_SYSTEM_STATE),
  }))

  const onSystemStateChange = useCallback(
    (update: SystemState | ((prev: SystemState) => SystemState)) => {
      setSystemState((prev) => {
        const next =
          typeof update === 'function' ? update(prev) : { ...prev, ...update }
        const perf = computePerformance(next)
        return { ...next, ...perf }
      })
    },
    []
  )

  return (
    <div className="min-h-screen bg-midnight flex flex-col">
      <NavBar />
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-auto p-4">
          <Canvas
            systemState={systemState}
            onSystemStateChange={onSystemStateChange}
          />
        </main>
        <aside className="w-80 shrink-0 overflow-auto">
          <SystemProperties
            systemState={systemState}
            onSystemStateChange={onSystemStateChange}
          />
        </aside>
      </div>
    </div>
  )
}

export default App
