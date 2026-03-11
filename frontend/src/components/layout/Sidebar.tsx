import { Link, useLocation } from 'react-router-dom'
import { Box, Layers, Settings, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

const navigation = [
  { name: 'Models', href: '/', icon: Box },
  { name: 'Deployments', href: '/deployments', icon: Layers },
  { name: 'Settings', href: '/settings', icon: Settings },
]

interface SidebarProps {
  /** Callback when a navigation item is clicked (used for mobile to close drawer) */
  onNavigate?: () => void
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const location = useLocation()

  const handleNavClick = () => {
    onNavigate?.()
  }

  return (
    <div
      className={cn(
        'flex h-full w-60 flex-col bg-background border-r border-white/5 overflow-hidden',
        onNavigate && 'shadow-soft-sm'
      )}
    >
      {/* Logo */}
      <div className="flex h-14 items-center border-b border-white/5 px-4 shrink-0">
        <Link
          to="/"
          className="flex items-center gap-2 min-w-0"
          onClick={handleNavClick}
        >
          <img src="/logo.png" alt="KubeAIRunway" className="h-8 w-8 shrink-0" />
          <span className="text-xl font-bold text-foreground whitespace-nowrap">
            KubeAIRunway
          </span>
        </Link>
        
        {/* Close button - mobile only */}
        {onNavigate && (
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden -mr-2"
            onClick={onNavigate}
            aria-label="Close sidebar"
          >
            <X className="h-5 w-5" />
          </Button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-3 md:p-4">
        {navigation.map((item) => {
          const isActive = location.pathname === item.href ||
            (item.href !== '/' && location.pathname.startsWith(item.href))

          return (
            <Link
              key={item.name}
              to={item.href}
              onClick={handleNavClick}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium',
                'transition-all duration-150 ease-out',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-soft-sm'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground active:scale-[0.98]'
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
                  'h-5 w-5 shrink-0 transition-transform duration-150',
                  isActive && 'scale-110'
                )}
              />
              <span className="whitespace-nowrap text-slate-300">
                {item.name}
              </span>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
