import { AlertCircle, CheckCircle, Loader2, XCircle } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import type { RuntimeStatus } from '@/lib/api'
import { cn } from '@/lib/utils'

import {
  canonicalizeRuntimeId,
  crdLessRuntimeReadinessMessage,
  crdLessRuntimeStateLabel,
  runtimeDescription,
  runtimeIdsMatch,
  runtimeRequiresCRD,
  type RuntimeId,
} from './settingsPageModel'

interface RuntimeSummaryCardProps {
  runtime: RuntimeStatus
  effectiveRuntime: RuntimeId
  pendingInstallRuntime: RuntimeId | null
  onSelect: (runtime: RuntimeId) => void
}

export function RuntimeSummaryCard({ runtime, effectiveRuntime, pendingInstallRuntime, onSelect }: RuntimeSummaryCardProps) {
  const requiresCRD = runtimeRequiresCRD(runtime)
  const ready = runtime.installed || runtime.healthy

  return (
    <div
      className={cn(
        'bg-white/[0.03] border border-white/5 rounded-2xl p-6 backdrop-blur-sm transition-all cursor-pointer',
        runtimeIdsMatch(effectiveRuntime, runtime.id)
          ? 'ring-2 ring-cyan-400'
          : 'hover:border-white/10'
      )}
      onClick={() => onSelect(canonicalizeRuntimeId(runtime.id))}
    >
      <div className="mb-3">
        <div className="flex items-center justify-between">
          <span className="font-heading font-bold">{runtime.name}</span>
          <RuntimeStatusBadge
            requiresCRD={requiresCRD}
            ready={ready}
            installed={runtime.installed}
            starting={runtimeIdsMatch(pendingInstallRuntime, runtime.id)}
          />
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          {runtimeDescription(runtime.id, runtime.name)}
        </p>
      </div>
      <div>
        <div className="space-y-2 text-sm">
          {!requiresCRD ? (
            <div className="flex items-center gap-2 rounded-lg bg-muted/60 p-3 text-muted-foreground">
              {ready ? (
                <CheckCircle className="h-4 w-4 text-green-400" />
              ) : (
                <AlertCircle className="h-4 w-4 text-yellow-500" />
              )}
              <span>{crdLessRuntimeReadinessMessage(ready)}</span>
            </div>
          ) : (
            <>
              <RuntimeHealthRow label="CRD" ok={runtime.crdFound ?? runtime.installed} />
              <RuntimeHealthRow label="Operator" ok={runtime.operatorRunning ?? runtime.healthy} />
            </>
          )}
          {runtime.version && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Version</span>
              <span className="font-mono text-xs">{runtime.version}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function RuntimeStatusBadge({
  requiresCRD,
  ready,
  installed,
  starting,
}: {
  requiresCRD: boolean
  ready?: boolean
  installed?: boolean
  starting: boolean
}) {
  if (!requiresCRD) {
    if (ready) {
      return (
        <Badge variant="success" className="shrink-0">
          <CheckCircle className="h-4 w-4" />
          {crdLessRuntimeStateLabel(true)}
        </Badge>
      )
    }

    return (
      <span className="text-muted-foreground text-sm flex items-center gap-1">
        <AlertCircle className="h-4 w-4 text-yellow-500" />
        {crdLessRuntimeStateLabel(false)}
      </span>
    )
  }

  if (installed) {
    return (
      <Badge variant="success" className="shrink-0">
        <CheckCircle className="h-4 w-4" />
        Installed
      </Badge>
    )
  }

  if (starting) {
    return (
      <span className="text-cyan-400 text-sm flex items-center gap-1">
        <Loader2 className="h-4 w-4 animate-spin" />
        Starting
      </span>
    )
  }

  return (
    <span className="text-muted-foreground text-sm flex items-center gap-1">
      <XCircle className="h-4 w-4 text-red-500" />
      Not Installed
    </span>
  )
}

function RuntimeHealthRow({ label, ok }: { label: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      {ok ? (
        <CheckCircle className="h-4 w-4 text-green-400" />
      ) : (
        <XCircle className="h-4 w-4 text-red-500" />
      )}
    </div>
  )
}
