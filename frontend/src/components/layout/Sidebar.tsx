import { Link, useLocation } from 'react-router-dom'
import { Box, Layers, Settings, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useClusterStatus } from '@/hooks/useClusterStatus'

const navigation = [
  { name: 'Models', href: '/', icon: Box },
  { name: 'Deployments', href: '/deployments', icon: Layers },
  { name: 'Settings', href: '/settings', icon: Settings },
]

interface SidebarProps {
  /** Callback when a navigation item is clicked (used for mobile to close drawer) */
  onNavigate?: () => void
}

function ClusterStatusDot() {
  const { data, isLoading } = useClusterStatus()

  const connected = data?.connected ?? false
  const connecting = isLoading

  let dotClass: string
  let label: string
  if (connecting) {
    dotClass = 'h-2.5 w-2.5 rounded-full bg-amber-500 animate-pulse'
    label = 'Connecting…'
  } else if (connected) {
    dotClass = 'h-2.5 w-2.5 rounded-full bg-emerald-500'
    label = 'Connected'
  } else {
    dotClass = 'h-2.5 w-2.5 rounded-full bg-red-500'
    label = 'Disconnected'
  }

  return (
    <div className="glass-subtle flex items-center gap-2 rounded-2xl px-3 py-2">
      <span className={dotClass} />
      <span className="text-xs text-slate-300">{label}</span>
    </div>
  )
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const location = useLocation()

  const handleNavClick = () => {
    onNavigate?.()
  }

  return (
    <div
      className={cn(
        'relative flex h-full w-64 flex-col overflow-hidden border-r border-white/10 bg-[#0F1419]/55 backdrop-blur-2xl',
        'shadow-[inset_-1px_0_0_rgba(255,255,255,0.05)]',
        onNavigate && 'shadow-[0_24px_60px_rgba(2,8,23,0.35)]'
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.06),_transparent_40%),linear-gradient(180deg,_rgba(255,255,255,0.04)_0%,_transparent_40%)]" />

      {/* Logo */}
      <div className="relative flex h-14 shrink-0 items-center border-b border-white/10 px-4">
        <Link
          to="/"
          className="flex items-center gap-2 min-w-0"
          onClick={handleNavClick}
        >
          <img src="/logo.png" alt="AI Runway" className="h-8 w-8 shrink-0" />
          <span className="text-xl font-bold text-foreground whitespace-nowrap">
            AI Runway
          </span>
        </Link>

        {onNavigate && (
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto -mr-2"
            onClick={onNavigate}
            aria-label="Close sidebar"
          >
            <X className="h-5 w-5" />
          </Button>
        )}
      </div>

      {/* Navigation */}
      <nav className="relative flex flex-1 flex-col items-stretch gap-1.5 px-3 py-4">
        {navigation.map((item) => {
          const isActive =
            location.pathname === item.href ||
            (item.href !== '/' && location.pathname.startsWith(item.href))

          return (
            <Link
              key={item.name}
              to={item.href}
              onClick={handleNavClick}
              className={cn(
                'group relative flex items-center gap-3 rounded-2xl border px-3 py-2.5 text-sm font-medium backdrop-blur-md',
                'transition-all duration-200 ease-out',
                isActive
                  ? 'border-cyan-400/20 bg-cyan-400/10 text-cyan-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                  : 'border-transparent text-muted-foreground hover:border-white/8 hover:bg-white/[0.05] hover:text-slate-100 active:scale-[0.98]'
              )}
            >
              <span
                className={cn(
                  'absolute left-0 w-1 h-8 rounded-full bg-primary transition-all duration-200 ease-out origin-center',
                  isActive
                    ? 'opacity-100 scale-y-100'
                    : 'opacity-0 scale-y-0'
                )}
              />
              <item.icon
                className={cn(
                  'h-5 w-5 shrink-0 transition-all duration-150',
                  isActive ? 'scale-110' : 'group-hover:scale-105'
                )}
              />
              <span className="whitespace-nowrap text-slate-300 transition-colors duration-150">
                {item.name}
              </span>
            </Link>
          )
        })}
      </nav>

      {/* Cluster status */}
      <div className="relative shrink-0 border-t border-white/10 px-3 py-3">
        <ClusterStatusDot />
      </div>
    </div>
  )
}
