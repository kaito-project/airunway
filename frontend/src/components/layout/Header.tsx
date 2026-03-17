import { useClusterStatus } from '@/hooks/useClusterStatus'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Wifi, WifiOff, Menu, ChevronRight } from 'lucide-react'
import { useSidebar } from './MainLayout'
import { useLocation, Link } from 'react-router-dom'

const routeLabels: Record<string, string> = {
  '': 'Models',
  deployments: 'Deployments',
  deploy: 'Deploy',
  settings: 'Settings',
}

function useBreadcrumbs() {
  const { pathname } = useLocation()
  const segments = pathname.split('/').filter(Boolean)

  if (segments.length === 0) {
    return [{ label: 'Models', path: '/', isLast: true }]
  }

  const crumbs: { label: string; path: string; isLast: boolean }[] = []

  // First segment determines the root
  const root = segments[0]
  if (root === 'deploy') {
    crumbs.push({ label: 'Models', path: '/', isLast: false })
    crumbs.push({ label: 'Deploy', path: '/deploy', isLast: segments.length === 1 })
  } else {
    const rootLabel = routeLabels[root] ?? root
    crumbs.push({ label: rootLabel, path: `/${root}`, isLast: segments.length === 1 })
  }

  // Remaining segments
  for (let i = 1; i < segments.length; i++) {
    const label = decodeURIComponent(segments[i])
    const path = '/' + segments.slice(0, i + 1).join('/')
    crumbs.push({ label, path, isLast: i === segments.length - 1 })
  }

  return crumbs
}

export function Header() {
  const { data: clusterStatus, isLoading } = useClusterStatus()
  const { toggle } = useSidebar()
  const breadcrumbs = useBreadcrumbs()

  return (
    <header className="sticky top-0 z-30 px-4 pt-3 md:px-6">
      <div className="glass-elevated relative flex h-14 items-center justify-between gap-4 overflow-hidden px-4 md:px-5">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.08),_transparent_45%)]" />

        <div className="relative flex min-w-0 items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden shrink-0 -ml-1 text-white/70 hover:bg-white/10 hover:text-white"
            onClick={toggle}
            aria-label="Toggle navigation menu"
          >
            <Menu className="h-5 w-5" />
          </Button>

          <nav className="hidden min-w-0 items-center gap-1 rounded-full border border-white/8 bg-black/10 px-2.5 py-1.5 text-sm backdrop-blur-md md:flex">
            {breadcrumbs.map((crumb, i) => (
              <span key={crumb.path} className="flex items-center gap-1 min-w-0">
                {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />}
                {crumb.isLast ? (
                  <span className="text-foreground font-medium truncate">{crumb.label}</span>
                ) : (
                  <Link
                    to={crumb.path}
                    className="text-muted-foreground hover:text-foreground transition-colors truncate"
                  >
                    {crumb.label}
                  </Link>
                )}
              </span>
            ))}
          </nav>
        </div>

        <div className="relative flex shrink-0 items-center gap-2 md:gap-3">
          <div className="flex items-center">
            {isLoading ? (
              <Badge variant="outline" pulse className="gap-1.5">
                <span className="h-2 w-2 rounded-full bg-yellow-500" />
                <span className="hidden sm:inline">Connecting...</span>
              </Badge>
            ) : clusterStatus?.connected ? (
              <Badge variant="success" className="gap-1.5">
                <Wifi className="h-3 w-3" />
                <span className="hidden sm:inline">Connected</span>
              </Badge>
            ) : (
              <Badge variant="destructive" className="gap-1.5">
                <WifiOff className="h-3 w-3" />
                <span className="hidden sm:inline">Disconnected</span>
              </Badge>
            )}
          </div>

          {clusterStatus?.clusterName && (
            <Badge
              variant="outline"
              className="hidden max-w-[170px] font-mono text-[11px] tracking-wide lg:inline-flex"
            >
              <span className="truncate">{clusterStatus.clusterName}</span>
            </Badge>
          )}
        </div>
      </div>
    </header>
  )
}
