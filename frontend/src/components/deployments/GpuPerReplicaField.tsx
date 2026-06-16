import { Sparkles } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { GpuRecommendation, MultiNodeRecommendation } from '@/lib/gpu-recommendations'

interface GpuPerReplicaFieldProps {
  id: string
  value: number
  onChange: (value: number) => void
  maxGpus?: number
  recommendation: GpuRecommendation
  aiConfigRecommended?: number | null
  multiNode?: MultiNodeRecommendation | null
}

export function GpuPerReplicaField({
  id,
  value,
  onChange,
  maxGpus = 8,
  recommendation,
  aiConfigRecommended,
  multiNode,
}: GpuPerReplicaFieldProps) {
  const isAiOptimized = aiConfigRecommended != null && value === aiConfigRecommended
  const isRecommended = value === recommendation.recommendedGpus

  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="flex items-center gap-2">
        GPUs per Replica
        {isAiOptimized ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
            <Sparkles className="h-3 w-3" />
            Optimized
          </span>
        ) : isRecommended && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
            <Sparkles className="h-3 w-3" />
            Recommended
          </span>
        )}
      </Label>
      <Input
        id={id}
        type="number"
        min={1}
        max={maxGpus}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value) || 1)}
      />
      <p className="text-xs text-muted-foreground">
        {recommendation.reason}
        {recommendation.alternatives && recommendation.alternatives.length > 0 && (
          <span className="block mt-1">
            Consider: {recommendation.alternatives.join(', ')} GPUs
          </span>
        )}
      </p>
      {multiNode && (
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
          Multi-Node ({multiNode.nodeCount} nodes × {multiNode.gpusPerNode} GPUs = {multiNode.totalGpus} total)
        </div>
      )}
    </div>
  )
}
