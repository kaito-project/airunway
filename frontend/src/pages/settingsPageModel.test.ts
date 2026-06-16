import { describe, expect, it } from 'vitest'

import {
  canonicalizeRuntimeId,
  crdLessRuntimeReadinessMessage,
  crdLessRuntimeStateLabel,
  runtimeDescription,
  runtimeIdsMatch,
  runtimeRequiresCRD,
  selectDefaultRuntimeId,
} from './settingsPageModel'

describe('settingsPageModel', () => {
  it('matches and canonicalizes runtime ids case-insensitively for known providers', () => {
    expect(runtimeIdsMatch('VLLM', 'vllm')).toBe(true)
    expect(canonicalizeRuntimeId('VLLM')).toBe('vllm')
    expect(canonicalizeRuntimeId('custom-vllm-provider')).toBe('custom-vllm-provider')
  })

  it('detects CRD-less runtimes by explicit flag, id, display name, and fallback id', () => {
    expect(runtimeRequiresCRD({ id: 'dynamo', requiresCRD: false })).toBe(false)
    expect(runtimeRequiresCRD({ id: 'llmd' })).toBe(false)
    expect(runtimeRequiresCRD({ id: 'custom', name: 'vLLM' })).toBe(false)
    expect(runtimeRequiresCRD({ id: 'custom' }, 'vllm')).toBe(false)
    expect(runtimeRequiresCRD({ id: 'dynamo' })).toBe(true)
    expect(runtimeRequiresCRD({ id: 'vllm', requiresCRD: true })).toBe(true)
  })

  it('describes known runtimes and CRD-less display-name aliases', () => {
    expect(runtimeDescription('llmd')).toBe('LLM-D for distributed inference')
    expect(runtimeDescription('custom-id', 'LLM-D')).toBe('LLM-D for distributed inference')
    expect(runtimeDescription('vllm')).toBe('vLLM for high-throughput inference')
    expect(runtimeDescription('kaito')).toBe('KAITO for simplified model deployment')
    expect(runtimeDescription('unknown')).toBe('Inference runtime provider')
  })

  it('labels CRD-less runtime readiness states', () => {
    expect(crdLessRuntimeReadinessMessage(true)).toBe('Runtime is ready to use.')
    expect(crdLessRuntimeReadinessMessage(false)).toBe('Provider is registered but not ready yet.')
    expect(crdLessRuntimeStateLabel(true)).toBe('Ready')
    expect(crdLessRuntimeStateLabel(false)).toBe('Registered')
  })

  it('selects default runtime by installed, then Dynamo, then first registered provider', () => {
    expect(selectDefaultRuntimeId(undefined)).toBeNull()
    expect(selectDefaultRuntimeId([
      { id: 'kuberay', installed: false },
      { id: 'VLLM', installed: true },
    ])).toBe('vllm')
    expect(selectDefaultRuntimeId([
      { id: 'kuberay', installed: false },
      { id: 'DYNAMO', installed: false },
    ])).toBe('dynamo')
    expect(selectDefaultRuntimeId([{ id: 'registered-vllm-provider', installed: false }])).toBe('registered-vllm-provider')
    expect(selectDefaultRuntimeId([])).toBe('dynamo')
  })
})
