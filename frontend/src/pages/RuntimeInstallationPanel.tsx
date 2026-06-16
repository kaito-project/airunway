import { AlertCircle, AlertTriangle, CheckCircle, Copy, Download, Loader2, RefreshCw, Server, Trash2, XCircle } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { InstallationStatus } from '@/lib/api'
import { cn } from '@/lib/utils'

import {
  crdLessRuntimeReadinessMessage,
  crdLessRuntimeStateLabel,
  type RuntimeId,
} from './settingsPageModel'

interface RuntimeInstallationPanelProps {
  installationStatus?: InstallationStatus
  currentRuntimeName?: string | null
  requiresCRD: boolean
  isInstalled: boolean
  isWaitingForInstall: boolean
  message: string
  loading: boolean
  effectiveRuntime: RuntimeId
  isInstalling: boolean
  isUninstalling: boolean
  helmAvailable: boolean
  clusterConnected?: boolean
  installationLoading: boolean
  onInstall: (runtime: RuntimeId) => void
  onShowUninstall: () => void
  onRefresh: () => void
  onCopyCommand: (command: string) => void
}

export function RuntimeInstallationPanel({
  installationStatus,
  currentRuntimeName,
  requiresCRD,
  isInstalled,
  isWaitingForInstall,
  message,
  loading,
  effectiveRuntime,
  isInstalling,
  isUninstalling,
  helmAvailable,
  clusterConnected,
  installationLoading,
  onInstall,
  onShowUninstall,
  onRefresh,
  onCopyCommand,
}: RuntimeInstallationPanelProps) {
  return (
    <>
      <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-6 backdrop-blur-sm">
        <div className="mb-4">
          <h3 className="font-heading text-lg font-semibold flex items-center justify-between">
            <div className="flex items-center gap-2">
              {requiresCRD ? (
                <Download className="h-5 w-5" />
              ) : (
                <Server className="h-5 w-5" />
              )}
              {installationStatus?.providerName || currentRuntimeName || 'Runtime'} {requiresCRD ? 'Installation' : 'Status'}
            </div>
            <RuntimeInstallStatusBadge
              requiresCRD={requiresCRD}
              isInstalled={isInstalled}
              isWaitingForInstall={isWaitingForInstall}
            />
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            {message}
          </p>
        </div>
        <div className="space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {requiresCRD ? (
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <RuntimeHealthTile label="CRD Installed" ok={installationStatus?.crdFound} />
                  <RuntimeHealthTile label="Operator Running" ok={installationStatus?.operatorRunning} />
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                  {isInstalled ? (
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-yellow-500" />
                  )}
                  <span>{crdLessRuntimeReadinessMessage(isInstalled)}</span>
                </div>
              )}

              {requiresCRD && (
                <div className="flex gap-3">
                  {!isInstalled && (
                    <Button
                      onClick={() => onInstall(effectiveRuntime)}
                      disabled={isInstalling || isWaitingForInstall || !helmAvailable || !clusterConnected}
                      className="flex items-center gap-2"
                    >
                      {isInstalling ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Installing...
                        </>
                      ) : isWaitingForInstall ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Checking runtime...
                        </>
                      ) : (
                        <>
                          <Download className="h-4 w-4" />
                          Install {currentRuntimeName || 'Runtime'}
                        </>
                      )}
                    </Button>
                  )}

                  {isInstalled && (
                    <Button
                      variant="destructive"
                      onClick={onShowUninstall}
                      disabled={isUninstalling || !helmAvailable || !clusterConnected}
                      className="flex items-center gap-2"
                    >
                      {isUninstalling ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Uninstalling...
                        </>
                      ) : (
                        <>
                          <Trash2 className="h-4 w-4" />
                          Uninstall
                        </>
                      )}
                    </Button>
                  )}

                  <Button
                    variant="outline"
                    aria-label="Refresh runtime status"
                    onClick={onRefresh}
                    disabled={installationLoading}
                  >
                    <RefreshCw className={cn('h-4 w-4', installationLoading && 'animate-spin')} />
                  </Button>
                </div>
              )}

              {requiresCRD && !helmAvailable && (
                <div className="flex items-start gap-2 rounded-lg bg-yellow-50 p-4 text-sm text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200">
                  <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">Helm CLI not available</p>
                    <p className="mt-1">
                      Automatic installation requires Helm. You can install the runtime manually using the commands below.
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {installationStatus?.installationSteps && installationStatus.installationSteps.length > 0 && (
        <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-6 backdrop-blur-sm">
          <div className="mb-4">
            <h3 className="font-heading text-lg font-semibold">Manual Installation Steps</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Detailed steps for installing {installationStatus.providerName}
            </p>
          </div>
          <div className="space-y-4">
            {installationStatus.installationSteps.map((step, index) => (
              <div key={index} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {index + 1}
                  </span>
                  <span className="font-medium">{step.title}</span>
                </div>
                <p className="ml-8 text-sm text-muted-foreground">{step.description}</p>
                {step.command && (
                  <div className="ml-8 flex items-center gap-2">
                    <code className="flex-1 rounded bg-muted px-3 py-2 text-sm font-mono">{step.command}</code>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Copy ${step.title} command`}
                      onClick={() => onCopyCommand(step.command!)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function RuntimeInstallStatusBadge({
  requiresCRD,
  isInstalled,
  isWaitingForInstall,
}: {
  requiresCRD: boolean
  isInstalled: boolean
  isWaitingForInstall: boolean
}) {
  if (!requiresCRD) {
    if (isInstalled) {
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

  if (isInstalled) {
    return (
      <Badge variant="success" className="shrink-0">
        <CheckCircle className="h-4 w-4" />
        Installed
      </Badge>
    )
  }

  if (isWaitingForInstall) {
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

function RuntimeHealthTile({ label, ok }: { label: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-muted p-3">
      <span>{label}</span>
      {ok ? (
        <CheckCircle className="h-4 w-4 text-green-500" />
      ) : (
        <XCircle className="h-4 w-4 text-red-500" />
      )}
    </div>
  )
}
