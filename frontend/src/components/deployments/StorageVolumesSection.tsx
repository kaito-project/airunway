import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Plus, X, HardDrive, Info } from 'lucide-react'
import type { StorageVolume, VolumePurpose, PersistentVolumeAccessMode } from '@kubeairunway/shared'

const MAX_VOLUMES = 8

const SYSTEM_PATHS = ['/dev', '/proc', '/sys', '/etc', '/var/run']

const PURPOSE_LABELS: Record<VolumePurpose, string> = {
  modelCache: 'Model Cache',
  compilationCache: 'Compilation Cache',
  custom: 'Custom',
}

const DEFAULT_MOUNT_PATHS: Partial<Record<VolumePurpose, string>> = {
  modelCache: '/model-cache',
  compilationCache: '/compilation-cache',
}

interface StorageVolumesSectionProps {
  volumes: StorageVolume[]
  onChange: (volumes: StorageVolume[]) => void
  deploymentName?: string
}

// Cross-browser info tooltip using native title + visible popover on hover/focus.
// Radix Tooltip is unreliable on Safari for small icon triggers.
function InfoHint({ text }: { text: string }) {
  return (
    <span className="relative group/hint inline-flex">
      <button
        type="button"
        tabIndex={0}
        aria-label={text}
        title={text}
        className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max max-w-xs rounded-lg border border-white/10 bg-[#0F1419]/95 backdrop-blur-md px-3 py-1.5 text-sm text-popover-foreground shadow-md opacity-0 transition-opacity group-hover/hint:opacity-100 group-focus-within/hint:opacity-100 z-50"
      >
        {text}
      </span>
    </span>
  )
}

function generateVolumeName(existingVolumes: StorageVolume[]): string {
  const existingNames = new Set(existingVolumes.map(v => v.name))
  for (let i = 1; i <= MAX_VOLUMES + 1; i++) {
    const name = `vol-${i}`
    if (!existingNames.has(name)) return name
  }
  return `vol-${Date.now()}`
}

function isSystemPath(path: string): boolean {
  return SYSTEM_PATHS.some(sp => path === sp || path.startsWith(sp + '/'))
}

function validateVolumeName(name: string, index: number, volumes: StorageVolume[]): string | null {
  if (!name) return 'Volume name is required'
  if (name.length > 63) return 'Must be 63 characters or less'
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name)) return 'Must be lowercase alphanumeric with hyphens'
  const duplicate = volumes.findIndex((v, i) => i !== index && v.name === name)
  if (duplicate >= 0) return 'Volume name must be unique'
  return null
}

function validateMountPath(mountPath: string | undefined, purpose: VolumePurpose | undefined, index: number, volumes: StorageVolume[]): string | null {
  if (!mountPath) {
    if (purpose === 'custom') return 'Mount path is required for custom volumes'
    return null
  }
  if (!mountPath.startsWith('/')) return 'Must be an absolute path (start with /)'
  if (isSystemPath(mountPath)) return `System path "${mountPath}" is not allowed`
  const duplicate = volumes.findIndex((v, i) => i !== index && v.mountPath === mountPath)
  if (duplicate >= 0) return 'Mount path must be unique across volumes'
  return null
}

export function StorageVolumesSection({ volumes, onChange, deploymentName }: StorageVolumesSectionProps) {
  // Track which volume cards have been interacted with for showing validation
  const [touched, setTouched] = useState<Record<number, Set<string>>>({})
  // Explicitly track PVC source mode per volume index.
  // Derived-from-data approach breaks because empty-string claimName is falsy.
  const [sourceModes, setSourceModes] = useState<Record<number, 'new' | 'existing'>>({})
  const markTouched = (index: number, field: string) => {
    setTouched(prev => {
      const fields = new Set(prev[index] || [])
      fields.add(field)
      return { ...prev, [index]: fields }
    })
  }

  const isTouched = (index: number, field: string) => touched[index]?.has(field) ?? false

  const addVolume = () => {
    if (volumes.length >= MAX_VOLUMES) return
    const newIndex = volumes.length
    const newVolume: StorageVolume = {
      name: generateVolumeName(volumes),
      purpose: 'custom',
      readOnly: false,
      size: '100Gi',
      accessMode: 'ReadWriteMany',
    }
    setSourceModes(prev => ({ ...prev, [newIndex]: 'new' }))
    onChange([...volumes, newVolume])
  }

  const removeVolume = (index: number) => {
    const updated = volumes.filter((_, i) => i !== index)
    onChange(updated)
    // Clean up touched + sourceMode state and re-index
    setTouched(prev => {
      const next = { ...prev }
      delete next[index]
      const reindexed: Record<number, Set<string>> = {}
      for (const [key, value] of Object.entries(next)) {
        const k = parseInt(key)
        reindexed[k > index ? k - 1 : k] = value
      }
      return reindexed
    })
    setSourceModes(prev => {
      const next = { ...prev }
      delete next[index]
      const reindexed: Record<number, 'new' | 'existing'> = {}
      for (const [key, value] of Object.entries(next)) {
        const k = parseInt(key)
        reindexed[k > index ? k - 1 : k] = value
      }
      return reindexed
    })
  }

  const updateVolume = (index: number, updates: Partial<StorageVolume>) => {
    const updated = volumes.map((v, i) => i === index ? { ...v, ...updates } : v)
    onChange(updated)
  }

  const handlePurposeChange = (index: number, purpose: VolumePurpose) => {
    const updates: Partial<StorageVolume> = { purpose }
    // Pre-fill mount path for cache purposes, but only if empty or matches previous default
    const currentVolume = volumes[index]
    const previousDefault = currentVolume.purpose ? DEFAULT_MOUNT_PATHS[currentVolume.purpose] : undefined
    const newDefault = DEFAULT_MOUNT_PATHS[purpose]
    if (newDefault && (!currentVolume.mountPath || currentVolume.mountPath === previousDefault)) {
      updates.mountPath = newDefault
    }
    updateVolume(index, updates)
  }

  // Check which singleton purposes are already used
  const usedPurposes = new Set(
    volumes
      .map(v => v.purpose)
      .filter((p): p is VolumePurpose => p === 'modelCache' || p === 'compilationCache')
  )

  // Determine source mode: use explicit state if set, otherwise derive from data
  // (for volumes loaded from existing config that didn't go through addVolume)
  const getSourceMode = (vol: StorageVolume, index: number): 'new' | 'existing' => {
    if (sourceModes[index] !== undefined) return sourceModes[index]
    // Derive from data for pre-existing volumes
    if (vol.size) return 'new'
    if (vol.claimName !== undefined) return 'existing'
    return 'new'
  }

  return (
      <div className="space-y-4">
        {volumes.map((vol, index) => {
          const nameError = isTouched(index, 'name') ? validateVolumeName(vol.name, index, volumes) : null
          const mountPathError = isTouched(index, 'mountPath') ? validateMountPath(vol.mountPath, vol.purpose, index, volumes) : null
          const sourceMode = getSourceMode(vol, index)
          const isNewPvc = sourceMode === 'new'

          return (
            <div
              key={index}
              className="relative rounded-xl border border-white/5 bg-white/[0.02] p-4 space-y-4"
            >
              {/* Remove button */}
              <button
                type="button"
                onClick={() => removeVolume(index)}
                className="absolute top-3 right-3 p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                aria-label={`Remove volume ${vol.name}`}
              >
                <X className="h-4 w-4" />
              </button>

              {/* Volume header */}
              <div className="flex items-center gap-2 pr-8">
                <HardDrive className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Volume {index + 1}</span>
                {vol.purpose && vol.purpose !== 'custom' && (
                  <Badge variant="outline" className="text-xs">
                    {PURPOSE_LABELS[vol.purpose]}
                  </Badge>
                )}
              </div>

              {/* Row 1: Name + Purpose */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`vol-name-${index}`}>Name</Label>
                  <Input
                    id={`vol-name-${index}`}
                    value={vol.name}
                    onChange={(e) => {
                      updateVolume(index, { name: e.target.value })
                      markTouched(index, 'name')
                    }}
                    onBlur={() => markTouched(index, 'name')}
                    placeholder="e.g. model-data"
                    className={nameError ? 'border-destructive' : ''}
                  />
                  {nameError && (
                    <p className="text-xs text-destructive">{nameError}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={`vol-purpose-${index}`}>Purpose</Label>
                  <Select
                    value={vol.purpose || 'custom'}
                    onValueChange={(value) => handlePurposeChange(index, value as VolumePurpose)}
                  >
                    <SelectTrigger id={`vol-purpose-${index}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(['modelCache', 'compilationCache', 'custom'] as VolumePurpose[]).map((purpose) => {
                        const isSingleton = purpose === 'modelCache' || purpose === 'compilationCache'
                        const isUsedElsewhere = isSingleton && usedPurposes.has(purpose) && vol.purpose !== purpose
                        return (
                          <SelectItem
                            key={purpose}
                            value={purpose}
                            disabled={isUsedElsewhere}
                          >
                            {PURPOSE_LABELS[purpose]}
                            {isUsedElsewhere && ' (already used)'}
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Row 2: Mount Path */}
              <div className="space-y-1.5">
                <Label htmlFor={`vol-mount-${index}`}>
                  Mount Path
                  {vol.purpose === 'custom' && <span className="text-destructive ml-1">*</span>}
                </Label>
                <Input
                  id={`vol-mount-${index}`}
                  value={vol.mountPath || ''}
                  onChange={(e) => {
                    updateVolume(index, { mountPath: e.target.value || undefined })
                    markTouched(index, 'mountPath')
                  }}
                  onBlur={() => markTouched(index, 'mountPath')}
                  placeholder={
                    vol.purpose === 'modelCache' ? '/model-cache' :
                    vol.purpose === 'compilationCache' ? '/compilation-cache' :
                    '/data/my-volume'
                  }
                  className={mountPathError ? 'border-destructive' : ''}
                />
                {mountPathError && (
                  <p className="text-xs text-destructive">{mountPathError}</p>
                )}
              </div>

              {/* Row 3: Storage Source Toggle */}
              <div className="space-y-3">
                <Label>Storage Source</Label>
                <RadioGroup
                  value={sourceMode}
                  onValueChange={(value) => {
                    const mode = value as 'new' | 'existing'
                    setSourceModes(prev => ({ ...prev, [index]: mode }))
                    if (mode === 'new') {
                      // Switching to "Create New PVC" - clear claimName, set a default size
                      updateVolume(index, {
                        size: vol.size || '100Gi',
                        claimName: undefined,
                        readOnly: false,
                        accessMode: vol.accessMode || 'ReadWriteMany',
                      })
                    } else {
                      // Switching to "Use Existing PVC" - clear size/storageClassName/accessMode
                      updateVolume(index, {
                        size: undefined,
                        storageClassName: undefined,
                        accessMode: undefined,
                        claimName: vol.claimName || '',
                      })
                    }
                  }}
                  className="flex gap-4"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="new" id={`vol-source-new-${index}`} />
                    <Label htmlFor={`vol-source-new-${index}`} className="font-normal cursor-pointer">
                      Create New PVC
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="existing" id={`vol-source-existing-${index}`} />
                    <Label htmlFor={`vol-source-existing-${index}`} className="font-normal cursor-pointer">
                      Use Existing PVC
                    </Label>
                  </div>
                </RadioGroup>

                {/* New PVC fields */}
                {isNewPvc && (
                  <div className="space-y-3 pl-4 border-l-2 border-white/5">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor={`vol-size-${index}`}>Size</Label>
                        <Input
                          id={`vol-size-${index}`}
                          value={vol.size || ''}
                          onChange={(e) => {
                            const newSize = e.target.value || undefined
                            updateVolume(index, { size: newSize })
                            // If the user clears size entirely, switch to "existing" mode
                            // so the claimName field becomes visible and the form stays valid.
                            if (!newSize) {
                              setSourceModes(prev => ({ ...prev, [index]: 'existing' }))
                            }
                          }}
                          placeholder="e.g. 100Gi"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`vol-access-${index}`}>Access Mode</Label>
                        <Select
                          value={vol.accessMode || 'ReadWriteMany'}
                          onValueChange={(value) => updateVolume(index, { accessMode: value as PersistentVolumeAccessMode })}
                        >
                          <SelectTrigger id={`vol-access-${index}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ReadWriteOnce">ReadWriteOnce</SelectItem>
                            <SelectItem value="ReadWriteMany">ReadWriteMany</SelectItem>
                            <SelectItem value="ReadOnlyMany">ReadOnlyMany</SelectItem>
                            <SelectItem value="ReadWriteOncePod">ReadWriteOncePod</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* Storage Class - 3-state handling */}
                    <StorageClassField
                      index={index}
                      storageClassName={vol.storageClassName}
                      onChange={(value) => updateVolume(index, { storageClassName: value })}
                    />
                  </div>
                )}

                {/* Existing PVC fields */}
                {!isNewPvc && (
                  <div className="space-y-3 pl-4 border-l-2 border-white/5">
                    <div className="space-y-1.5">
                      <Label htmlFor={`vol-claim-${index}`}>
                        PVC Claim Name <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id={`vol-claim-${index}`}
                        value={vol.claimName || ''}
                        onChange={(e) => {
                          updateVolume(index, { claimName: e.target.value || undefined })
                          markTouched(index, 'claimName')
                        }}
                        onBlur={() => markTouched(index, 'claimName')}
                        placeholder="my-existing-pvc"
                        className={isTouched(index, 'claimName') && !vol.claimName ? 'border-destructive' : ''}
                      />
                      {isTouched(index, 'claimName') && !vol.claimName && (
                        <p className="text-xs text-destructive">Claim name is required for existing PVCs</p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Row 4: Read Only toggle */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Label className="font-normal">Read Only</Label>
                  {isNewPvc && (
                    <InfoHint text="Controller-created PVCs require write access" />
                  )}
                </div>
                <Switch
                  checked={vol.readOnly || false}
                  onCheckedChange={(checked) => updateVolume(index, { readOnly: checked })}
                  disabled={isNewPvc}
                />
              </div>

              {/* Auto-generated claim name preview */}
              {isNewPvc && deploymentName && vol.name && (
                <p className="text-xs text-muted-foreground">
                  PVC name: <code className="font-mono-code">{deploymentName}-{vol.name}</code>
                </p>
              )}
            </div>
          )
        })}

        {/* Add Volume Button */}
        <Button
          type="button"
          variant="outline"
          onClick={addVolume}
          disabled={volumes.length >= MAX_VOLUMES}
          className="w-full border-dashed"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Volume
          {volumes.length > 0 && (
            <span className="ml-2 text-muted-foreground">
              ({volumes.length}/{MAX_VOLUMES})
            </span>
          )}
        </Button>
      </div>
  )
}

// Sub-component: 3-state storage class field
function StorageClassField({
  index,
  storageClassName,
  onChange,
}: {
  index: number
  storageClassName: string | undefined
  onChange: (value: string | undefined) => void
}) {
  // 3 states:
  // - undefined → use cluster default (checkbox checked)
  // - '' → explicit empty string (disables dynamic provisioning)
  // - 'some-value' → named class
  const useClusterDefault = storageClassName === undefined

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label htmlFor={`vol-sc-${index}`}>Storage Class</Label>
        <InfoHint text="Cluster default: omits storageClassName (uses cluster's default StorageClass). Custom: specify a class name, or leave empty to disable dynamic provisioning." />
      </div>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={useClusterDefault}
            onChange={(e) => {
              if (e.target.checked) {
                onChange(undefined)
              } else {
                onChange('')
              }
            }}
            className="rounded border-white/20"
          />
          Use cluster default
        </label>
      </div>

      {!useClusterDefault && (
        <Input
          id={`vol-sc-${index}`}
          value={storageClassName || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. premium-ssd (leave empty to disable dynamic provisioning)"
        />
      )}
    </div>
  )
}
