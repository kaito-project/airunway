import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { Engine } from '@airunway/shared'

interface ModelSearchProps {
  search: string
  onSearchChange: (value: string) => void
  selectedEngines: Engine[]
  onEngineToggle: (engine: Engine) => void
}

const engines: { value: Engine; label: string }[] = [
  { value: 'vllm', label: 'vLLM' },
  { value: 'sglang', label: 'SGLang' },
  { value: 'trtllm', label: 'TensorRT-LLM' },
  { value: 'llamacpp', label: 'Llama.cpp' },
]

export function ModelSearch({
  search,
  onSearchChange,
  selectedEngines,
  onEngineToggle,
}: ModelSearchProps) {
  return (
    <div className="glass-panel !p-4 space-y-4 md:!p-5">
      <div className="relative">
        <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
        <Input
          placeholder="Search models..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-12 rounded-2xl pl-12 text-base placeholder:text-slate-500"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {engines.map((engine) => {
          const isSelected = selectedEngines.includes(engine.value)
          return (
            <button
              key={engine.value}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm transition-all duration-200 backdrop-blur-md',
                isSelected
                  ? 'border-cyan-400/30 bg-cyan-400/12 text-cyan-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
                  : 'border-white/10 bg-white/[0.04] text-slate-400 hover:border-white/15 hover:bg-white/[0.07] hover:text-slate-200'
              )}
              onClick={() => onEngineToggle(engine.value)}
            >
              {engine.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
