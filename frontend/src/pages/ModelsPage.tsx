import { useState, useMemo } from 'react'
import { useModels } from '@/hooks/useModels'
import { useGpuCapacity } from '@/hooks/useGpuOperator'
import { ModelGrid } from '@/components/models/ModelGrid'
import { ModelSearch } from '@/components/models/ModelSearch'
import { HfModelSearch } from '@/components/models/HfModelSearch'
import { SkeletonGrid } from '@/components/ui/skeleton'
import { BookMarked, Search, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Engine } from '@airunway/shared'
import { getGpuFitCapacityDisplay } from '@/lib/gpu-fit-capacity'

type Tab = 'curated' | 'huggingface'

export function ModelsPage() {
  const { data: models, isLoading, error } = useModels()
  const { data: gpuCapacity } = useGpuCapacity()
  const [search, setSearch] = useState('')
  const [selectedEngines, setSelectedEngines] = useState<Engine[]>([])
  const [activeTab, setActiveTab] = useState<Tab>('curated')
  const gpuFitCapacity = getGpuFitCapacityDisplay(gpuCapacity)

  const filteredModels = useMemo(() => {
    if (!models) return []

    return models.filter((model) => {
      // Filter by search
      const searchMatch = search === '' ||
        model.name.toLowerCase().includes(search.toLowerCase()) ||
        model.id.toLowerCase().includes(search.toLowerCase()) ||
        model.description.toLowerCase().includes(search.toLowerCase())

      // Filter by engine
      const engineMatch = selectedEngines.length === 0 ||
        selectedEngines.some((engine) => model.supportedEngines.includes(engine))

      return searchMatch && engineMatch
    })
  }, [models, search, selectedEngines])

  const handleEngineToggle = (engine: Engine) => {
    setSelectedEngines((prev) =>
      prev.includes(engine)
        ? prev.filter((e) => e !== engine)
        : [...prev, engine]
    )
  }

  if (isLoading && activeTab === 'curated') {
    return (
      <div className="space-y-6">
        <div className="glass-panel py-8 text-center">
          <h1 className="font-heading text-4xl flex items-center justify-center gap-3">
            Model Catalog
            <Sparkles className="h-7 w-7 text-cyan-400" />
          </h1>
          <p className="text-slate-400 mt-2">
            Browse curated models or search HuggingFace Hub
          </p>
        </div>
        <SkeletonGrid count={8} className="lg:grid-cols-4" />
      </div>
    )
  }

  if (error && activeTab === 'curated') {
    return (
      <div className="glass-panel flex flex-col items-center justify-center py-12 text-center">
        <p className="text-lg font-medium text-destructive">
          Failed to load models
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          {error instanceof Error ? error.message : 'Unknown error'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Hero section */}
      <div className="glass-panel relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.16),_transparent_34%),radial-gradient(circle_at_bottom_right,_rgba(59,130,246,0.12),_transparent_32%)]" />

        <div className="relative flex flex-col gap-6">
          <div className="text-center">
            <h1 className="font-heading text-4xl flex items-center justify-center gap-3">
              Model Catalog
              <Sparkles className="h-7 w-7 text-cyan-400" />
            </h1>
            <p className="text-slate-400 mt-2">
              Browse curated models or search HuggingFace Hub
            </p>
          </div>

          <div className="flex justify-center">
            <div className="glass-subtle inline-flex flex-wrap items-center justify-center gap-1 rounded-2xl p-1.5">
              <button
                onClick={() => setActiveTab('curated')}
                className={cn(
                  'flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all duration-200',
                  activeTab === 'curated'
                    ? 'bg-white/[0.08] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_12px_28px_rgba(2,8,23,0.18)]'
                    : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200'
                )}
              >
                <BookMarked className={cn(
                  "h-4 w-4 transition-transform duration-200",
                  activeTab === 'curated' && "scale-110"
                )} />
                Curated Models
              </button>
              <button
                onClick={() => setActiveTab('huggingface')}
                className={cn(
                  'flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all duration-200',
                  activeTab === 'huggingface'
                    ? 'bg-white/[0.08] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_12px_28px_rgba(2,8,23,0.18)]'
                    : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200'
                )}
              >
                <Search className={cn(
                  "h-4 w-4 transition-transform duration-200",
                  activeTab === 'huggingface' && "scale-110"
                )} />
                HuggingFace Hub
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-slate-300">
            <div className="glass-subtle rounded-full px-3 py-1.5">
              Curated picks and live hub search in one place
            </div>
            {models && (
              <div className="glass-subtle rounded-full px-3 py-1.5 tabular-nums">
                {filteredModels.length} of {models.length} ready to explore
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Curated models tab */}
      {activeTab === 'curated' && (
        <>
          <ModelSearch
            search={search}
            onSearchChange={setSearch}
            selectedEngines={selectedEngines}
            onEngineToggle={handleEngineToggle}
          />
          <ModelGrid
            models={filteredModels}
            gpuCapacityGb={gpuCapacity?.totalMemoryGb}
            gpuCount={gpuFitCapacity.gpuCount}
            gpuCapacityLabel={gpuFitCapacity.capacityLabel}
          />
        </>
      )}

      {/* HuggingFace search tab */}
      {activeTab === 'huggingface' && (
        <HfModelSearch
          gpuCapacityGb={gpuCapacity?.totalMemoryGb}
          gpuCount={gpuFitCapacity.gpuCount}
          gpuCapacityLabel={gpuFitCapacity.capacityLabel}
        />
      )}
    </div>
  )
}
