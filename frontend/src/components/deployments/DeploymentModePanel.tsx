import { Sparkles } from 'lucide-react'

import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { cn } from '@/lib/utils'

import type { DeploymentMode, RuntimeId } from './deploymentFormModel'

interface DeploymentModePanelProps {
  mode: DeploymentMode
  selectedRuntime: RuntimeId
  aiConfigRecommendedMode: DeploymentMode | null
  onModeChange: (mode: DeploymentMode) => void
}

export function DeploymentModePanel({
  mode,
  selectedRuntime,
  aiConfigRecommendedMode,
  onModeChange,
}: DeploymentModePanelProps) {
  const disaggregatedDisabled = selectedRuntime === 'kaito'

  return (
    <div className="glass-panel">
      <h3 className="text-lg font-semibold mb-4">Deployment Mode</h3>
      <div>
        <RadioGroup
          value={mode}
          onValueChange={(value) => {
            if (!disaggregatedDisabled) {
              onModeChange(value as DeploymentMode)
            }
          }}
          className="grid gap-4 sm:grid-cols-2"
        >
          <div className="flex items-start space-x-2">
            <RadioGroupItem value="aggregated" id="mode-aggregated" className="mt-1" />
            <div>
              <Label htmlFor="mode-aggregated" className="cursor-pointer font-medium flex items-center gap-2">
                Aggregated (Standard)
                {aiConfigRecommendedMode === 'aggregated' && <OptimizedBadge />}
              </Label>
              <p className="text-xs text-muted-foreground">
                Combined prefill and decode on same workers
              </p>
            </div>
          </div>
          <div className={cn('flex items-start space-x-2', disaggregatedDisabled && 'opacity-50')}>
            <RadioGroupItem
              value="disaggregated"
              id="mode-disaggregated"
              className="mt-1"
              disabled={disaggregatedDisabled}
            />
            <div>
              <Label
                htmlFor="mode-disaggregated"
                className={cn(
                  'font-medium flex items-center gap-2',
                  disaggregatedDisabled ? 'cursor-not-allowed' : 'cursor-pointer'
                )}
              >
                Disaggregated (P/D)
                {aiConfigRecommendedMode === 'disaggregated' && <OptimizedBadge />}
              </Label>
              <p className="text-xs text-muted-foreground">
                {disaggregatedDisabled
                  ? 'Separate prefill and decode workers - not supported by KAITO'
                  : 'Separate prefill and decode workers for better resource utilization'}
              </p>
            </div>
          </div>
        </RadioGroup>
      </div>
    </div>
  )
}

function OptimizedBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
      <Sparkles className="h-3 w-3" />
      Optimized
    </span>
  )
}
