import { AlertCircle, CheckCircle, Cpu, Loader2 } from 'lucide-react'

import type { GPUOperatorStatus } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

interface GpuOperatorPanelProps {
  status?: GPUOperatorStatus
  loading: boolean
  installing: boolean
  clusterConnected?: boolean
  helmAvailable?: boolean
  onInstall: () => void
  onCopyCommand: (command: string) => void
}

export function GpuOperatorPanel({
  status,
  loading,
  installing,
  clusterConnected,
  helmAvailable,
  onInstall,
  onCopyCommand,
}: GpuOperatorPanelProps) {
  return (
    <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-6 backdrop-blur-sm">
      <div className="mb-4">
        <h3 className="font-heading text-lg font-semibold flex items-center gap-2">
          <Cpu className="h-5 w-5" />
          NVIDIA GPU Operator
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Install the NVIDIA GPU Operator to enable GPU support
        </p>
      </div>
      <div className="space-y-4">
        <GpuPrerequisitesNotice clusterConnected={clusterConnected} helmAvailable={helmAvailable} />
        <GpuOperatorStatusPanel
          status={status}
          loading={loading}
          installing={installing}
          clusterConnected={clusterConnected}
          helmAvailable={helmAvailable}
          onInstall={onInstall}
          onCopyCommand={onCopyCommand}
        />
      </div>
    </div>
  )
}

function GpuPrerequisitesNotice({
  clusterConnected,
  helmAvailable,
}: {
  clusterConnected?: boolean
  helmAvailable?: boolean
}) {
  if (clusterConnected && helmAvailable) {
    return null
  }

  return (
    <div className="rounded-lg bg-yellow-50 dark:bg-yellow-950 p-3 text-sm text-yellow-800 dark:text-yellow-200">
      <div className="flex items-center gap-2 mb-2">
        <AlertCircle className="h-4 w-4" />
        <span className="font-medium">Prerequisites not met</span>
      </div>
      <ul className="list-disc list-inside space-y-1 ml-2">
        {!clusterConnected && <li>Not connected</li>}
        {!helmAvailable && <li>Helm CLI not available</li>}
      </ul>
    </div>
  )
}

function GpuOperatorStatusPanel({
  status,
  loading,
  installing,
  clusterConnected,
  helmAvailable,
  onInstall,
  onCopyCommand,
}: {
  status?: GPUOperatorStatus
  loading: boolean
  installing: boolean
  clusterConnected?: boolean
  helmAvailable?: boolean
  onInstall: () => void
  onCopyCommand: (command: string) => void
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Checking GPU status...</span>
      </div>
    )
  }

  if (status?.gpusAvailable) {
    return <GpusAvailableStatus status={status} />
  }

  if (status?.installed) {
    return <OperatorInstalledWithoutGpusStatus status={status} />
  }

  return (
    <GpuOperatorInstallPrompt
      status={status}
      installing={installing}
      clusterConnected={clusterConnected}
      helmAvailable={helmAvailable}
      onInstall={onInstall}
      onCopyCommand={onCopyCommand}
    />
  )
}

function GpusAvailableStatus({ status }: { status: GPUOperatorStatus }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">GPU Status</span>
        <Badge variant="success">
          <CheckCircle className="h-3 w-3 mr-1" />
          GPUs Enabled
        </Badge>
      </div>
      <div className="rounded-lg bg-green-50 dark:bg-green-950 p-3 text-sm text-green-800 dark:text-green-200">
        <div className="flex items-center gap-2">
          <CheckCircle className="h-4 w-4" />
          <span>{status.message}</span>
        </div>
        {status.gpuNodes.length > 0 && (
          <div className="mt-2 text-xs">
            Nodes: {status.gpuNodes.join(', ')}
          </div>
        )}
      </div>
    </div>
  )
}

function OperatorInstalledWithoutGpusStatus({ status }: { status: GPUOperatorStatus }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">GPU Status</span>
        <Badge variant="secondary">
          <AlertCircle className="h-3 w-3 mr-1" />
          Operator Installed
        </Badge>
      </div>
      <div className="rounded-lg bg-yellow-50 dark:bg-yellow-950 p-3 text-sm text-yellow-800 dark:text-yellow-200">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          <span>{status.message}</span>
        </div>
      </div>
    </div>
  )
}

function GpuOperatorInstallPrompt({
  status,
  installing,
  clusterConnected,
  helmAvailable,
  onInstall,
  onCopyCommand,
}: {
  status?: GPUOperatorStatus
  installing: boolean
  clusterConnected?: boolean
  helmAvailable?: boolean
  onInstall: () => void
  onCopyCommand: (command: string) => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="gpu-operator-switch">Enable GPU Operator</Label>
          <p className="text-xs text-muted-foreground">
            Automatically installs the NVIDIA GPU Operator via Helm
          </p>
        </div>
        <Switch
          id="gpu-operator-switch"
          checked={false}
          disabled={!clusterConnected || !helmAvailable || installing}
          onCheckedChange={(checked) => {
            if (checked) {
              onInstall()
            }
          }}
        />
      </div>

      {installing && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Installing GPU Operator... This may take several minutes.</span>
        </div>
      )}

      {status?.helmCommands && status.helmCommands.length > 0 && (
        <div className="space-y-2">
          <span className="text-sm font-medium">Manual Installation</span>
          <div className="space-y-1">
            {status.helmCommands.map((command, index) => (
              <div key={index} className="flex items-center gap-2">
                <code className="flex-1 rounded bg-muted px-3 py-2 text-xs font-mono">
                  {command}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onCopyCommand(command)}
                >
                  Copy
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
