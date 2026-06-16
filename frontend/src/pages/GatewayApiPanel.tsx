import { AlertCircle, CheckCircle, Download, Globe, Loader2, RefreshCw, XCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { GatewayCRDStatus } from '@/lib/api'
import { cn } from '@/lib/utils'

interface GatewayApiPanelProps {
  status?: GatewayCRDStatus
  loading: boolean
  installing: boolean
  clusterConnected?: boolean
  onRefresh: () => void
  onInstall: () => void
  onCopyCommand: (command: string) => void
}

export function GatewayApiPanel({
  status,
  loading,
  installing,
  clusterConnected,
  onRefresh,
  onInstall,
  onCopyCommand,
}: GatewayApiPanelProps) {
  const needsInstall = !status?.gatewayApiInstalled || !status?.inferenceExtInstalled

  return (
    <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-6 backdrop-blur-sm">
      <div className="mb-4">
        <h3 className="font-heading text-lg font-semibold flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Gateway API
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh gateway status"
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Install Gateway API and Inference Extension CRDs for unified model access
        </p>
      </div>
      <div className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Checking gateway CRD status...</span>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <GatewayCrdTile label="Gateway API CRDs" ok={status?.gatewayApiInstalled} />
              <GatewayCrdTile
                label={(
                  <div className="flex items-center gap-1">
                    <span>Inference Extension</span>
                    {status?.inferenceExtInstalled && status?.inferenceExtVersion && (
                      <span className="text-xs text-muted-foreground">({status.inferenceExtVersion})</span>
                    )}
                  </div>
                )}
                ok={status?.inferenceExtInstalled}
              />
            </div>

            {status?.gatewayApiInstalled && status?.inferenceExtInstalled && (
              <div className="flex items-center justify-between rounded-lg bg-muted p-3 text-sm">
                <span>Gateway</span>
                <div className="flex items-center gap-2">
                  {status.gatewayAvailable ? (
                    <>
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      <span className="text-green-600 dark:text-green-400">
                        {status.gatewayEndpoint || 'Available'}
                      </span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="h-4 w-4 text-yellow-500" />
                      <span className="text-muted-foreground">Not detected</span>
                    </>
                  )}
                </div>
              </div>
            )}

            {status?.message && (
              <div className={cn(
                'rounded-lg p-3 text-sm',
                status.gatewayApiInstalled && status.inferenceExtInstalled
                  ? status.gatewayAvailable
                    ? 'bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200'
                    : 'bg-yellow-50 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200'
                  : 'bg-muted text-muted-foreground'
              )}>
                {status.message}
              </div>
            )}

            {needsInstall && (
              <Button
                onClick={onInstall}
                disabled={installing || !clusterConnected}
                className="flex items-center gap-2"
              >
                {installing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Installing CRDs...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    Install CRDs
                  </>
                )}
              </Button>
            )}

            {status?.installCommands && status.installCommands.length > 0 && (
              <div className="space-y-2">
                <span className="text-sm font-medium">Manual Installation</span>
                <div className="space-y-1">
                  {status.installCommands.map((cmd, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <code className="flex-1 rounded bg-muted px-3 py-2 text-xs font-mono overflow-x-auto">
                        {cmd}
                      </code>
                      <Button variant="outline" size="sm" onClick={() => onCopyCommand(cmd)}>
                        Copy
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function GatewayCrdTile({ label, ok }: { label: React.ReactNode; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-muted p-3">
      {typeof label === 'string' ? <span>{label}</span> : label}
      {ok ? (
        <CheckCircle className="h-4 w-4 text-green-500" />
      ) : (
        <XCircle className="h-4 w-4 text-red-500" />
      )}
    </div>
  )
}
