import { Sparkles } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import type { DeploymentConfig } from '@/hooks/useDeployments'
import type { DetailedClusterCapacity } from '@/lib/api'
import type { GpuRecommendation, MultiNodeRecommendation } from '@/lib/gpu-recommendations'

import { GpuPerReplicaField } from './GpuPerReplicaField'
import type {
  AIConfigRecommendedValues,
  KaitoComputeType,
  RouterMode,
  RuntimeId,
} from './deploymentFormModel'

interface DeploymentOptionsPanelProps {
  config: DeploymentConfig
  selectedRuntime: RuntimeId
  isVllmModel: boolean
  kaitoComputeType: KaitoComputeType
  detailedCapacity?: DetailedClusterCapacity
  gpuRecommendation: GpuRecommendation
  aiConfigRecommendedValues: AIConfigRecommendedValues | null
  currentMultiNode: MultiNodeRecommendation | null
  onReplicasChange: (value: number) => void
  onGpuPerReplicaChange: (value: number) => void
  onRouterModeChange: (value: RouterMode) => void
  onPrefillReplicasChange: (value: number) => void
  onPrefillGpusChange: (value: number) => void
  onDecodeReplicasChange: (value: number) => void
  onDecodeGpusChange: (value: number) => void
}

export function DeploymentOptionsPanel({
  config,
  selectedRuntime,
  isVllmModel,
  kaitoComputeType,
  detailedCapacity,
  gpuRecommendation,
  aiConfigRecommendedValues,
  currentMultiNode,
  onReplicasChange,
  onGpuPerReplicaChange,
  onRouterModeChange,
  onPrefillReplicasChange,
  onPrefillGpusChange,
  onDecodeReplicasChange,
  onDecodeGpusChange,
}: DeploymentOptionsPanelProps) {
  if (selectedRuntime === 'kaito' && !isVllmModel && kaitoComputeType !== 'gpu') {
    return null
  }

  return (
    <div className="glass-panel">
      <h3 className="text-lg font-semibold mb-4">Deployment Options</h3>
      <div className="space-y-4">
        {config.mode === 'aggregated' || selectedRuntime === 'kaito' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="replicas">Worker Replicas</Label>
              <Input
                id="replicas"
                type="number"
                min={1}
                max={10}
                value={config.replicas}
                onChange={(e) => onReplicasChange(parseInt(e.target.value) || 1)}
              />
            </div>

            <GpuPerReplicaField
              id="gpusPerReplica"
              value={config.resources?.gpu || gpuRecommendation.recommendedGpus}
              onChange={onGpuPerReplicaChange}
              maxGpus={detailedCapacity?.maxNodeGpuCapacity || 8}
              recommendation={gpuRecommendation}
              aiConfigRecommended={aiConfigRecommendedValues?.gpuPerReplica}
              multiNode={currentMultiNode}
            />

            {selectedRuntime === 'dynamo' && (
              <div className="space-y-2">
                <Label>Router Mode</Label>
                <RadioGroup
                  value={config.routerMode}
                  onValueChange={(value) => onRouterModeChange(value as RouterMode)}
                  className="flex gap-4"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="default" id="router-default" />
                    <Label htmlFor="router-default" className="cursor-pointer">Default</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="kv" id="router-kv" />
                    <Label htmlFor="router-kv" className="cursor-pointer">KV-Aware</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="round-robin" id="router-rr" />
                    <Label htmlFor="router-rr" className="cursor-pointer">Round Robin</Label>
                  </div>
                </RadioGroup>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="space-y-3">
              <h4 className="font-medium text-sm">Prefill Workers</h4>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="prefillReplicas" className="flex items-center gap-2">
                    Replicas
                    {aiConfigRecommendedValues?.prefillReplicas === config.prefillReplicas && <OptimizedDot />}
                  </Label>
                  <Input
                    id="prefillReplicas"
                    type="number"
                    min={1}
                    max={10}
                    value={config.prefillReplicas || 1}
                    onChange={(e) => onPrefillReplicasChange(parseInt(e.target.value) || 1)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="prefillGpus" className="flex items-center gap-2">
                    GPUs per Worker
                    {aiConfigRecommendedValues?.prefillGpus === config.prefillGpus && <OptimizedDot />}
                  </Label>
                  <Input
                    id="prefillGpus"
                    type="number"
                    min={1}
                    max={8}
                    value={config.prefillGpus || 1}
                    onChange={(e) => onPrefillGpusChange(parseInt(e.target.value) || 1)}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="font-medium text-sm">Decode Workers</h4>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="decodeReplicas" className="flex items-center gap-2">
                    Replicas
                    {aiConfigRecommendedValues?.decodeReplicas === config.decodeReplicas && <OptimizedDot />}
                  </Label>
                  <Input
                    id="decodeReplicas"
                    type="number"
                    min={1}
                    max={10}
                    value={config.decodeReplicas || 1}
                    onChange={(e) => onDecodeReplicasChange(parseInt(e.target.value) || 1)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="decodeGpus" className="flex items-center gap-2">
                    GPUs per Worker
                    {aiConfigRecommendedValues?.decodeGpus === config.decodeGpus && <OptimizedDot />}
                  </Label>
                  <Input
                    id="decodeGpus"
                    type="number"
                    min={1}
                    max={8}
                    value={config.decodeGpus || 1}
                    onChange={(e) => onDecodeGpusChange(parseInt(e.target.value) || 1)}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function OptimizedDot() {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
      <Sparkles className="h-2.5 w-2.5" />
    </span>
  )
}
