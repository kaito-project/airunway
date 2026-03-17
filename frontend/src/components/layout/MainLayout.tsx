import { ReactNode, useState, useCallback, useEffect, createContext, useContext } from 'react'
import { Sidebar } from './Sidebar'
import { Header } from './Header'

interface SidebarContextValue {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  toggle: () => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useSidebar() {
  const context = useContext(SidebarContext)
  if (!context) {
    throw new Error('useSidebar must be used within MainLayout')
  }
  return context
}

interface MainLayoutProps {
  children: ReactNode
}

export function MainLayout({ children }: MainLayoutProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  const toggle = useCallback(() => {
    setIsSidebarOpen(prev => !prev)
  }, [])

  // Close mobile drawer on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isSidebarOpen) {
        setIsSidebarOpen(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isSidebarOpen])

  // Prevent body scroll when mobile drawer is open
  useEffect(() => {
    if (isSidebarOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isSidebarOpen])

  const contextValue: SidebarContextValue = {
    isOpen: isSidebarOpen,
    setIsOpen: setIsSidebarOpen,
    toggle,
  }

  return (
    <SidebarContext.Provider value={contextValue}>
      <div className="flex h-screen bg-background">
        {/* Desktop navigation rail — always visible */}
        <div className="hidden md:flex h-full shrink-0">
          <Sidebar />
        </div>

        {/* Mobile overlay */}
        {isSidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden animate-fade-in"
            onClick={() => setIsSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Mobile drawer */}
        <div
          className={[
            'fixed inset-y-0 left-0 z-50 md:hidden',
            'transition-transform duration-300 ease-out-expo',
            isSidebarOpen ? 'translate-x-0' : '-translate-x-full',
          ].join(' ')}
        >
          <Sidebar onNavigate={() => setIsSidebarOpen(false)} />
        </div>

        {/* Main content */}
        <div className="relative isolate flex flex-1 flex-col overflow-hidden">
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -left-24 top-20 h-72 w-72 rounded-full bg-cyan-400/10 blur-3xl" />
            <div className="absolute right-[-5rem] top-[-3rem] h-80 w-80 rounded-full bg-blue-500/10 blur-3xl" />
            <div className="absolute bottom-[-8rem] left-1/3 h-96 w-96 rounded-full bg-sky-300/5 blur-3xl" />
          </div>
          <Header />
          <main className="relative flex-1 overflow-auto bg-decor">
            <div className="relative mx-auto max-w-[1400px] p-4 md:p-6">
              {children}
            </div>
          </main>
        </div>
      </div>
    </SidebarContext.Provider>
  )
}
