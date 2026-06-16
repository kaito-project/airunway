import { Sparkles } from 'lucide-react'

import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import type { Engine } from '@/lib/api'
import { cn } from '@/lib/utils'

import type { RuntimeId, TraditionalEngine } from './deploymentFormModel'

interface EngineSelectionPanelProps {
  selectedRuntime: RuntimeId
  isVllmModel: boolean
  runtimeName: string
  availableEngines: TraditionalEngine[]
  engine: Engine
  aiConfigSupportedBackends: string[] | null
  aiConfigRecommendedBackend: string | null
  onEngineChange: (engine: Engine) => void
}

function engineLabel(engine: TraditionalEngine): string {
  if (engine === 'vllm') return 'vLLM'
  if (engine === 'sglang') return 'SGLang'
  return 'TensorRT-LLM'
}

export function EngineSelectionPanel({
  selectedRuntime,
  isVllmModel,
  runtimeName,
  availableEngines,
  engine,
  aiConfigSupportedBackends,
  aiConfigRecommendedBackend,
  onEngineChange,
}: EngineSelectionPanelProps) {
  return (
    <div className="glass-panel">
      <h3 className="text-lg font-semibold mb-4">Inference Engine</h3>
      <div>
        {selectedRuntime === 'kaito' && isVllmModel ? (
          <RadioGroup value="vllm" className="flex gap-4">
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="vllm" id="engine-vllm" />
              <Label htmlFor="engine-vllm" className="cursor-pointer">
                vLLM
              </Label>
            </div>
          </RadioGroup>
        ) : availableEngines.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No compatible engines available for this model with {runtimeName}.
          </p>
        ) : (
          <div className="space-y-3">
            <RadioGroup
              value={engine}
              onValueChange={(value) => {
                if (!aiConfigSupportedBackends || aiConfigSupportedBackends.includes(value)) {
                  onEngineChange(value as Engine)
                }
              }}
              className="grid gap-4 sm:grid-cols-3"
            >
              {availableEngines.map((availableEngine) => {
                const isUnavailable = aiConfigSupportedBackends !== null && !aiConfigSupportedBackends.includes(availableEngine)
                const isRecommended = aiConfigRecommendedBackend === availableEngine

                return (
                  <div
                    key={availableEngine}
                    className={cn(
                      'flex items-center space-x-2',
                      isUnavailable && 'opacity-50'
                    )}
                  >
                    <RadioGroupItem
                      value={availableEngine}
                      id={availableEngine}
                      disabled={isUnavailable}
                    />
                    <Label
                      htmlFor={availableEngine}
                      className={cn(
                        isUnavailable ? 'cursor-not-allowed' : 'cursor-pointer',
                        'flex items-center gap-2'
                      )}
                    >
                      {engineLabel(availableEngine)}
                      {isRecommended && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                          <Sparkles className="h-3 w-3" />
                          Optimized
                        </span>
                      )}
                    </Label>
                  </div>
                )
              })}
            </RadioGroup>
            {aiConfigSupportedBackends && aiConfigSupportedBackends.length < availableEngines.length && (
              <p className="text-xs text-muted-foreground">
                Some engines are unavailable based on your GPU type. AI Configurator recommends {aiConfigRecommendedBackend?.toUpperCase()}.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
