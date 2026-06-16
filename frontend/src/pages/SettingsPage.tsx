import { useState, useEffect } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { useRuntimesStatus } from '@/hooks/useRuntimes'
import { useClusterStatus } from '@/hooks/useClusterStatus'
import {
  useHelmStatus,
  useProviderInstallationStatus,
  useInstallProvider,
  useUninstallProvider,
} from '@/hooks/useInstallation'
import { useAutoscalerDetection } from '@/hooks/useAutoscaler'
import { useGpuOperatorStatus, useInstallGpuOperator } from '@/hooks/useGpuOperator'
import { useGatewayCRDStatus, useInstallGatewayCRDs } from '@/hooks/useGateway'
import { useHuggingFaceStatus, useHuggingFaceOAuth, useDeleteHuggingFaceSecret } from '@/hooks/useHuggingFace'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { AutoscalerGuidance } from '@/components/autoscaler/AutoscalerGuidance'
import { useToast } from '@/hooks/useToast'
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  Server,
  Key,
  Cog,
  Layers,
  Download,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { RuntimeSummaryCard } from './RuntimeSummaryCard'
import { RuntimeInstallationPanel } from './RuntimeInstallationPanel'
import { GatewayApiPanel } from './GatewayApiPanel'
import { HuggingFaceTokenPanel } from './HuggingFaceTokenPanel'
import { GpuOperatorPanel } from './GpuOperatorPanel'
import { useSearchParams } from 'react-router-dom'
import {
  crdLessRuntimeReadinessMessage,
  runtimeIdsMatch,
  runtimeRequiresCRD,
  selectDefaultRuntimeId,
  type RuntimeId,
} from './settingsPageModel'

type SettingsTab = 'general' | 'runtimes' | 'integrations'
export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { isLoading: settingsLoading } = useSettings()
  const { data: runtimesStatus, isLoading: runtimesLoading, refetch: refetchRuntimesStatus } = useRuntimesStatus()
  const { data: clusterStatus, isLoading: clusterLoading } = useClusterStatus()
  const { data: helmStatus, isLoading: helmLoading } = useHelmStatus()
  const { data: autoscaler, isLoading: autoscalerLoading } = useAutoscalerDetection()
  const { data: gpuOperatorStatus, isLoading: gpuStatusLoading, refetch: refetchGpuStatus } = useGpuOperatorStatus()
  const { data: gatewayCRDStatus, isLoading: gatewayStatusLoading, refetch: refetchGatewayStatus } = useGatewayCRDStatus()
  const installGatewayCRDs = useInstallGatewayCRDs()
  const { data: hfStatus, isLoading: hfStatusLoading, refetch: refetchHfStatus } = useHuggingFaceStatus()
  const { startOAuth } = useHuggingFaceOAuth()
  const deleteHfSecret = useDeleteHuggingFaceSecret()
  const installGpuOperator = useInstallGpuOperator()
  const { toast } = useToast()

  const [isInstallingGpu, setIsInstallingGpu] = useState(false)
  const [isInstallingGateway, setIsInstallingGateway] = useState(false)
  const [isConnectingHf, setIsConnectingHf] = useState(false)
  
  // Tab state from URL params or default
  const tabFromUrl = searchParams.get('tab') as SettingsTab | null
  const [activeTab, setActiveTab] = useState<SettingsTab>(tabFromUrl || 'general')
  
  // Runtime installation state
  const [selectedRuntime, setSelectedRuntime] = useState<RuntimeId | null>(null)
  const [isInstalling, setIsInstalling] = useState(false)
  const [pendingInstallRuntime, setPendingInstallRuntime] = useState<RuntimeId | null>(null)
  const [isUninstalling, setIsUninstalling] = useState(false)
  const [showUninstallDialog, setShowUninstallDialog] = useState(false)

  const runtimes = runtimesStatus?.runtimes || []
  const readyRuntimeCount = runtimes.filter(r => runtimeRequiresCRD(r) ? r.installed : (r.installed || r.healthy)).length
  const helmAvailable = helmStatus?.available ?? false
  const defaultRuntime = selectDefaultRuntimeId(runtimesStatus?.runtimes)

  // Set default runtime once data is loaded
  useEffect(() => {
    if (runtimesStatus?.runtimes && selectedRuntime === null && defaultRuntime) {
      setSelectedRuntime(defaultRuntime)
    }
  }, [runtimesStatus, selectedRuntime, defaultRuntime])

  // Update URL when tab changes
  useEffect(() => {
    if (activeTab !== 'general') {
      setSearchParams({ tab: activeTab })
    } else {
      setSearchParams({})
    }
  }, [activeTab, setSearchParams])

  const effectiveRuntime = selectedRuntime || defaultRuntime || ''

  const {
    data: installationStatus,
    isLoading: installationLoading,
    refetch: refetchInstallation,
  } = useProviderInstallationStatus(effectiveRuntime)

  const currentRuntime = runtimes.find(r => runtimeIdsMatch(r.id, effectiveRuntime))
  const selectedRuntimeRequiresCRD = runtimeRequiresCRD({
    id: currentRuntime?.id ?? effectiveRuntime,
    name: currentRuntime?.name ?? installationStatus?.providerName,
    requiresCRD: installationStatus?.requiresCRD ?? currentRuntime?.requiresCRD,
  }, effectiveRuntime)

  const installProvider = useInstallProvider()
  const uninstallProvider = useUninstallProvider()

  const handleInstall = async (providerId: RuntimeId) => {
    setIsInstalling(true)
    try {
      const result = await installProvider.mutateAsync(providerId)
      if (result.success) {
        setPendingInstallRuntime(providerId)
        toast({ title: 'Installation Started', description: `${result.message}. Waiting for the runtime service to become ready.` })
        refetchInstallation()
        refetchRuntimesStatus()
      } else {
        toast({ title: 'Installation Failed', description: result.message, variant: 'destructive' })
      }
    } catch (error) {
      toast({ title: 'Installation Error', description: error instanceof Error ? error.message : 'Unknown error occurred', variant: 'destructive' })
    } finally {
      setIsInstalling(false)
    }
  }

  const handleUninstall = async (providerId: RuntimeId) => {
    setIsUninstalling(true)
    setShowUninstallDialog(false)
    try {
      const result = await uninstallProvider.mutateAsync(providerId)
      if (result.success) {
        setPendingInstallRuntime((current) => current === providerId ? null : current)
        toast({ title: 'Uninstall Complete', description: result.message })
        refetchInstallation()
        refetchRuntimesStatus()
      } else {
        toast({ title: 'Uninstall Failed', description: result.message, variant: 'destructive' })
      }
    } catch (error) {
      toast({ title: 'Uninstall Error', description: error instanceof Error ? error.message : 'Unknown error occurred', variant: 'destructive' })
    } finally {
      setIsUninstalling(false)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast({ title: 'Copied', description: 'Command copied to clipboard' })
  }

  const isInstalled = installationStatus?.installed ?? false
  const isWaitingForInstall = selectedRuntimeRequiresCRD && pendingInstallRuntime !== null && runtimeIdsMatch(pendingInstallRuntime, effectiveRuntime) && !isInstalled
  const selectedRuntimeMessage = isWaitingForInstall
    ? 'Install command completed. Waiting for the runtime service to become ready...'
    : selectedRuntimeRequiresCRD
      ? installationStatus?.message || 'Checking installation status...'
      : installationLoading && !installationStatus
        ? 'Checking readiness...'
        : crdLessRuntimeReadinessMessage(isInstalled)

  useEffect(() => {
    if (runtimeIdsMatch(pendingInstallRuntime, effectiveRuntime) && isInstalled) {
      setPendingInstallRuntime(null)
    }
  }, [effectiveRuntime, isInstalled, pendingInstallRuntime])

  useEffect(() => {
    if (!isWaitingForInstall) return

    const intervalId = window.setInterval(() => {
      refetchInstallation()
      refetchRuntimesStatus()
    }, 5000)

    return () => window.clearInterval(intervalId)
  }, [isWaitingForInstall, refetchInstallation, refetchRuntimesStatus])

  if (settingsLoading || clusterLoading || runtimesLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-heading font-bold tracking-tight flex items-center gap-2">
            <Cog className="h-7 w-7 text-muted-foreground" />
            Settings
          </h1>
          <p className="text-muted-foreground mt-1">
            Configure your inference runtimes and application settings.
          </p>
        </div>
        <div className="space-y-4">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-48 w-full rounded-lg" />
          <Skeleton className="h-48 w-full rounded-lg" />
        </div>
      </div>
    )
  }

  const tabs = [
    { id: 'general' as const, label: 'General', icon: Server },
    { id: 'runtimes' as const, label: 'Runtimes', icon: Layers },
    { id: 'integrations' as const, label: 'Integrations', icon: Key },
  ]

  return (
    <div className="space-y-6 animate-slide-up">
      <div>
        <h1 className="text-3xl font-heading font-bold tracking-tight flex items-center gap-2">
          <Cog className="h-7 w-7 text-muted-foreground" />
          Settings
        </h1>
        <p className="text-muted-foreground mt-1">
          Configure your inference runtimes and application settings.
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b border-white/5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all duration-200 border-b-2 -mb-px',
              activeTab === tab.id
                ? 'border-cyan-400 text-cyan-400'
                : 'border-transparent text-slate-500 hover:text-foreground'
            )}
          >
            <tab.icon className={cn(
              "h-4 w-4 transition-transform duration-200",
              activeTab === tab.id && "scale-110"
            )} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* General Tab */}
      {activeTab === 'general' && (
        <div className="space-y-6 animate-slide-up">
          {/* Cluster Status */}
          <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-6 backdrop-blur-sm">
            <div className="mb-4">
              <h3 className="font-heading text-lg font-semibold flex items-center gap-2">
                <Server className="h-5 w-5" />
                Cluster Status
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Current connection status
              </p>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Connection</span>
                <div className="flex items-center gap-2">
                  {clusterStatus?.connected ? (
                    <>
                      <CheckCircle className="h-4 w-4 text-green-400" />
                      <span className="text-sm text-green-400">Connected</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 text-red-500" />
                      <span className="text-sm text-red-500">Disconnected</span>
                    </>
                  )}
                </div>
              </div>

              {clusterStatus?.clusterName && (
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Cluster</span>
                  <span className="text-sm text-muted-foreground font-mono">{clusterStatus.clusterName}</span>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Runtimes Ready</span>
                <Badge variant={readyRuntimeCount > 0 ? 'default' : 'secondary'}>
                  {readyRuntimeCount} of {runtimes.length}
                </Badge>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Runtimes Tab */}
      {activeTab === 'runtimes' && (
        <div className="space-y-6 animate-slide-up">
          {/* Prerequisites */}
          <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-6 backdrop-blur-sm">
            <div className="mb-4">
              <h3 className="font-heading text-lg font-semibold flex items-center gap-2">
                <Server className="h-5 w-5" />
                Prerequisites
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Required components for runtime installation
              </p>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Environment</span>
                <div className="flex items-center gap-2">
                  {clusterStatus?.connected ? (
                    <>
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      <span className="text-sm text-green-600">Connected</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 text-red-500" />
                      <span className="text-sm text-red-600">Not Connected</span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Helm CLI</span>
                  {helmStatus?.version && (
                    <span className="text-xs text-muted-foreground">({helmStatus.version})</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {helmLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : helmAvailable ? (
                    <>
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      <span className="text-sm text-green-600">Available</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 text-red-500" />
                      <span className="text-sm text-red-600">Not Found</span>
                    </>
                  )}
                </div>
              </div>

              {!helmAvailable && helmStatus?.error && (
                <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
                  {helmStatus.error}
                </div>
              )}
            </div>
          </div>

          {/* Cluster Autoscaling Status */}
          <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-6 backdrop-blur-sm">
            <div className="mb-4">
              <h3 className="font-heading text-lg font-semibold flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="h-5 w-5" />
                  Cluster Autoscaling
                </div>
                {autoscalerLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : autoscaler?.detected ? (
                  <Badge variant={autoscaler.healthy ? 'default' : 'destructive'}>
                    {autoscaler.healthy ? 'Healthy' : 'Unhealthy'}
                  </Badge>
                ) : (
                  <Badge variant="secondary">Not Detected</Badge>
                )}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Automatically provision GPU compute resources when deployments require more resources
              </p>
            </div>
            <div className="space-y-4">
              {autoscalerLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  <div className="space-y-3 text-sm">
                    <div className="flex items-center justify-between rounded-lg bg-muted p-3">
                      <span>Status</span>
                      <div className="flex items-center gap-2">
                        {autoscaler?.detected ? (
                          <>
                            {autoscaler.healthy ? (
                              <CheckCircle className="h-4 w-4 text-green-500" />
                            ) : (
                              <AlertTriangle className="h-4 w-4 text-yellow-500" />
                            )}
                            <span className="font-medium">
                              {autoscaler.type === 'aks-managed' ? 'AKS Managed' : 'Cluster Autoscaler'}
                            </span>
                          </>
                        ) : (
                          <>
                            <XCircle className="h-4 w-4 text-gray-400" />
                            <span className="text-muted-foreground">Not Detected</span>
                          </>
                        )}
                      </div>
                    </div>

                    {autoscaler?.detected && autoscaler.nodeGroupCount !== undefined && (
                      <div className="flex items-center justify-between rounded-lg bg-muted p-3">
                        <span>Node Pools</span>
                        <span className="font-medium">{autoscaler.nodeGroupCount}</span>
                      </div>
                    )}

                    {autoscaler?.message && (
                      <div className={cn(
                        'rounded-lg p-3 text-sm',
                        autoscaler.healthy
                          ? 'bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200'
                          : autoscaler.detected
                            ? 'bg-yellow-50 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200'
                            : 'bg-muted text-muted-foreground'
                      )}>
                        {autoscaler.message}
                      </div>
                    )}
                  </div>

                  {autoscaler && !autoscaler.detected && (
                    <AutoscalerGuidance autoscaler={autoscaler} />
                  )}
                </>
              )}
            </div>
          </div>

          {/* Runtimes Overview */}
          <div>
            <h2 className="text-xl font-heading font-semibold mb-4">Available Runtimes</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {runtimes.map((runtime) => (
                <RuntimeSummaryCard
                  key={runtime.id}
                  runtime={runtime}
                  effectiveRuntime={effectiveRuntime}
                  pendingInstallRuntime={pendingInstallRuntime}
                  onSelect={setSelectedRuntime}
                />
              ))}
            </div>
          </div>



          {runtimes.length === 0 && !runtimesLoading && (
            <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-6 backdrop-blur-sm">
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Download className="h-8 w-8 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">
                  No inference providers are registered. Deploy an InferenceProviderConfig to get started.
                </p>
              </div>
            </div>
          )}

          {/* Selected Runtime Installation Details */}
          {runtimes.length > 0 && (
            <RuntimeInstallationPanel
              installationStatus={installationStatus}
              currentRuntimeName={currentRuntime?.name}
              requiresCRD={selectedRuntimeRequiresCRD}
              isInstalled={isInstalled}
              isWaitingForInstall={isWaitingForInstall}
              message={selectedRuntimeMessage}
              loading={installationLoading}
              effectiveRuntime={effectiveRuntime}
              isInstalling={isInstalling}
              isUninstalling={isUninstalling}
              helmAvailable={helmAvailable}
              clusterConnected={clusterStatus?.connected}
              installationLoading={installationLoading}
              onInstall={handleInstall}
              onShowUninstall={() => setShowUninstallDialog(true)}
              onRefresh={() => {
                refetchInstallation()
                refetchRuntimesStatus()
              }}
              onCopyCommand={copyToClipboard}
            />
          )}
        </div>
      )}

      {/* Integrations Tab */}
      {activeTab === 'integrations' && (
        <div className="space-y-6 animate-slide-up">
          {/* GPU Operator */}
          <GpuOperatorPanel
            status={gpuOperatorStatus}
            loading={gpuStatusLoading}
            installing={isInstallingGpu}
            clusterConnected={clusterStatus?.connected}
            helmAvailable={helmStatus?.available}
            onInstall={async () => {
              setIsInstallingGpu(true)
              try {
                const result = await installGpuOperator.mutateAsync()
                if (result.success) {
                  toast({
                    title: 'GPU Operator Installed',
                    description: result.message,
                  })
                  refetchGpuStatus()
                }
              } catch (error) {
                toast({
                  title: 'Installation Failed',
                  description: error instanceof Error ? error.message : 'Unknown error',
                  variant: 'destructive',
                })
              } finally {
                setIsInstallingGpu(false)
              }
            }}
            onCopyCommand={(command) => {
              navigator.clipboard.writeText(command)
              toast({
                title: 'Copied',
                description: 'Command copied to clipboard',
              })
            }}
          />

          {/* Gateway API */}
          <GatewayApiPanel
            status={gatewayCRDStatus}
            loading={gatewayStatusLoading}
            installing={isInstallingGateway}
            clusterConnected={clusterStatus?.connected}
            onRefresh={() => refetchGatewayStatus()}
            onInstall={async () => {
              setIsInstallingGateway(true)
              try {
                const result = await installGatewayCRDs.mutateAsync()
                if (result.success) {
                  toast({
                    title: 'CRDs Installed',
                    description: result.message,
                  })
                  refetchGatewayStatus()
                }
              } catch (error) {
                toast({
                  title: 'Installation Failed',
                  description: error instanceof Error ? error.message : 'Unknown error',
                  variant: 'destructive',
                })
              } finally {
                setIsInstallingGateway(false)
              }
            }}
            onCopyCommand={(cmd) => {
              navigator.clipboard.writeText(cmd)
              toast({
                title: 'Copied',
                description: 'Command copied to clipboard',
              })
            }}
          />

          {/* HuggingFace Token */}
          <HuggingFaceTokenPanel
            loading={hfStatusLoading}
            configured={hfStatus?.configured}
            user={hfStatus?.user}
            connecting={isConnectingHf}
            disconnecting={deleteHfSecret.isPending}
            onConnect={async () => {
              setIsConnectingHf(true)
              try {
                await startOAuth()
              } catch (error) {
                toast({
                  title: 'Error',
                  description: error instanceof Error ? error.message : 'Failed to start OAuth',
                  variant: 'destructive',
                })
                setIsConnectingHf(false)
              }
            }}
            onDisconnect={async () => {
              try {
                await deleteHfSecret.mutateAsync()
                toast({
                  title: 'Disconnected',
                  description: 'HuggingFace token has been removed',
                })
                refetchHfStatus()
              } catch (error) {
                toast({
                  title: 'Error',
                  description: error instanceof Error ? error.message : 'Failed to disconnect',
                  variant: 'destructive',
                })
              }
            }}
          />
        </div>
      )}

      {/* Uninstall Confirmation Dialog */}
      <Dialog open={showUninstallDialog} onOpenChange={setShowUninstallDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Uninstall Runtime</DialogTitle>
            <DialogDescription>
              Are you sure you want to uninstall {runtimes.find(r => r.id === effectiveRuntime)?.name || 'this runtime'}?
              This will remove the operator and all associated resources.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUninstallDialog(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => handleUninstall(effectiveRuntime)}>
              Uninstall
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
