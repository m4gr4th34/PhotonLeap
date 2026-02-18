import { Circle, Layers, Settings, FileCode } from 'lucide-react'

const navItems = [
  { id: 'lens', label: 'Lens Designer', icon: Circle },
  { id: 'system', label: 'System Editor', icon: Layers },
  { id: 'properties', label: 'Properties', icon: Settings },
  { id: 'export', label: 'Export', icon: FileCode },
]

export function NavBar() {
  return (
    <div className="glass-card border-b border-white/10 rounded-none">
      <nav className="flex items-center gap-1 px-6 py-3">
        <div className="flex items-center gap-2 mr-8">
          <span className="text-cyan-electric font-semibold text-lg">Lens Designer</span>
        </div>
        {navItems.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-slate-300 hover:text-cyan-electric hover:bg-white/5 transition-colors"
            >
              <Icon className="w-4 h-4" strokeWidth={2} />
              <span className="text-sm font-medium">{item.label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}
