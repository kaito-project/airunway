import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Server } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import type { Engine, RuntimeStatus } from '@/lib/api'
import { cn } from '@/lib/utils'

import {
  RUNTIME_INFO,
  isRuntimeCompatible,
  type RuntimeId,
} from './deploymentFormModel'

interface RuntimeSelectionPanelProps {
  runtimes: RuntimeStatus[]
  selectedRuntime: RuntimeId
  modelEngines: Engine[]
  onRuntimeChange: (runtime: RuntimeId) => void
}

export function RuntimeSelectionPanel({
  runtimes,
  selectedRuntime,
  modelEngines,
  onRuntimeChange,
}: RuntimeSelectionPanelProps) {
  return (
    <div className="glass-panel">
      <h3 className="text-lg font-semibold flex items-center gap-2 mb-4">
        <Server className="h-5 w-5" />
        Runtime
      </h3>
      <div className="grid gap-4 sm:grid-cols-2">
        {runtimes.map((runtime) => {
          const runtimeId = runtime.id as RuntimeId
          const info = RUNTIME_INFO[runtimeId]
          if (!info) return null

          const isCompatible = isRuntimeCompatible(runtimeId, modelEngines)
          const isSelected = selectedRuntime === runtime.id
          const isCrdLessRuntime = runtime.requiresCRD === false
          const isCrdLessRuntimeNotReady = isCrdLessRuntime && !runtime.installed

          return (
            <div
              key={runtime.id}
              role="radio"
              aria-checked={isSelected}
              tabIndex={isCompatible ? 0 : -1}
              onClick={() => {
                if (isCompatible) {
                  onRuntimeChange(runtimeId)
                }
              }}
              onKeyDown={(e) => {
                if (isCompatible && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault()
                  onRuntimeChange(runtimeId)
                }
              }}
              className={cn(
                'relative flex items-start space-x-3 rounded-xl border p-4 transition-all duration-200 bg-white/[0.02]',
                !isCompatible && 'opacity-50 cursor-not-allowed',
                isCompatible && 'cursor-pointer',
                isCompatible && isSelected
                  ? 'border-cyan-400/50 bg-cyan-500/5 shadow-[0_0_15px_rgba(0,217,255,0.15)]'
                  : 'border-white/5',
                isCompatible && !isSelected && 'hover:border-white/10 hover:bg-white/[0.03]',
                isCompatible && !runtime.installed && 'opacity-75'
              )}
            >
              <div
                className={cn(
                  'mt-1 h-4 w-4 rounded-full border flex items-center justify-center shrink-0',
                  isSelected ? 'border-cyan-400' : 'border-muted-foreground/50',
                  !isCompatible && 'opacity-50'
                )}
              >
                {isSelected && (
                  <div className="h-2.5 w-2.5 rounded-full bg-cyan-400" />
                )}
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'font-medium text-sm',
                      isCompatible ? 'cursor-pointer' : 'cursor-not-allowed'
                    )}
                  >
                    {info.name}
                  </span>
                  <RuntimeStatusBadge
                    compatible={isCompatible}
                    installed={runtime.installed}
                    crdLess={isCrdLessRuntime}
                    crdLessNotReady={isCrdLessRuntimeNotReady}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {info.description}
                </p>
                {!isCompatible && (
                  <p className="text-xs text-muted-foreground mt-1">
                    This model requires {modelEngines.includes('llamacpp') ? 'llama.cpp' : modelEngines.join('/')} which is not supported by this runtime.
                  </p>
                )}
                {isCompatible && !runtime.installed && isSelected && (
                  <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-2">
                    {isCrdLessRuntime ? (
                      'Provider is registered but not ready yet.'
                    ) : (
                      <>
                        <Link to="/installation" className="underline hover:no-underline">
                          Install {info.name}
                        </Link>{' '}
                        before deploying.
                      </>
                    )}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RuntimeStatusBadge({
  compatible,
  installed,
  crdLess,
  crdLessNotReady,
}: {
  compatible: boolean
  installed?: boolean
  crdLess: boolean
  crdLessNotReady: boolean
}) {
  if (!compatible) {
    return (
      <Badge variant="outline" className="text-muted-foreground border-muted text-xs">
        Not Compatible
      </Badge>
    )
  }

  if (installed) {
    return (
      <Badge variant="outline" className="text-green-400 border-green-500/50 bg-green-500/10 text-xs">
        <CheckCircle2 className="h-3 w-3 mr-1" />
        {crdLess ? 'Registered' : 'Installed'}
      </Badge>
    )
  }

  return (
    <Badge variant="outline" className="text-yellow-400 border-yellow-500/50 bg-yellow-500/10 text-xs">
      <AlertTriangle className="h-3 w-3 mr-1" />
      {crdLessNotReady ? 'Not Ready' : 'Not Installed'}
    </Badge>
  )
}
