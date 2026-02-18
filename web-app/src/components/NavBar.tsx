import { Circle, Layers, Settings, FileCode } from 'lucide-react'

export type NavTab = 'lens' | 'system' | 'properties' | 'export'

const navItems: { id: NavTab; label: string; icon: typeof Circle }[] = [
  { id: 'lens', label: 'Lens Designer', icon: Circle },
  { id: 'system', label: 'System Editor', icon: Layers },
  { id: 'properties', label: 'Properties', icon: Settings },
  { id: 'export', label: 'Export', icon: FileCode },
]

type NavBarProps = {
  activeTab: NavTab
  onTabChange: (tab: NavTab) => void
  loadedFileName?: string | null
}

export function NavBar({ activeTab, onTabChange, loadedFileName }: NavBarProps) {
  return (
    <div className="glass-card border-b border-white/10 rounded-none">
      <nav className="flex items-center gap-1 px-6 py-3">
        <div className="flex items-center gap-4 mr-8">
          <span className="text-cyan-electric font-semibold text-lg">
            Lens Designer
          </span>
          {loadedFileName && (
            <span className="text-slate-400 text-sm font-medium">
              File: {loadedFileName}
            </span>
          )}
        </div>
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = activeTab === item.id
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                isActive
                  ? 'text-cyan-electric bg-white/10'
                  : 'text-slate-300 hover:text-cyan-electric hover:bg-white/5'
              }`}
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
