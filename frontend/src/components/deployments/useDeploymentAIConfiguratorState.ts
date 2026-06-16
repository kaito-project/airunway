import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'

import type { DeploymentConfig } from '@/hooks/useDeployments'
import type { AIConfiguratorResult } from '@/lib/api'

import {
  applyAIConfiguratorResultToConfig,
  getAIConfigRecommendedValues,
  getAIConfiguratorAppliedToastDescription,
  type AIConfigRecommendedValues,
  type DeploymentMode,
  type RuntimeId,
} from './deploymentFormModel'

type DeploymentToast = (notification: {
  title: string
  description?: string
  variant?: 'success' | 'destructive'
}) => void

interface UseDeploymentAIConfiguratorStateOptions {
  selectedRuntime: RuntimeId
  setConfig: Dispatch<SetStateAction<DeploymentConfig>>
  toast: DeploymentToast
}

export function useDeploymentAIConfiguratorState({
  selectedRuntime,
  setConfig,
  toast,
}: UseDeploymentAIConfiguratorStateOptions) {
  const [supportedBackends, setSupportedBackends] = useState<string[] | null>(null)
  const [recommendedBackend, setRecommendedBackend] = useState<string | null>(null)
  const [recommendedMode, setRecommendedMode] = useState<DeploymentMode | null>(null)
  const [recommendedValues, setRecommendedValues] = useState<AIConfigRecommendedValues | null>(null)
  const [topologyManagedByAIConfig, setTopologyManagedByAIConfig] = useState(false)

  const discard = useCallback(() => {
    setTopologyManagedByAIConfig(false)
    setSupportedBackends(null)
    setRecommendedBackend(null)
    setRecommendedMode(null)
    setRecommendedValues(null)
  }, [])

  const markTopologyManuallyEdited = useCallback(() => {
    setTopologyManagedByAIConfig(false)
  }, [])

  const resetForRuntime = useCallback((runtime: RuntimeId) => {
    setTopologyManagedByAIConfig(false)
    if (runtime !== 'dynamo') {
      setSupportedBackends(null)
      setRecommendedBackend(null)
      setRecommendedMode(null)
      setRecommendedValues(null)
    }
  }, [])

  const applyConfig = useCallback((result: AIConfiguratorResult) => {
    if (result.supportedBackends) {
      setSupportedBackends(result.supportedBackends)
    }
    if (result.backend) {
      setRecommendedBackend(result.backend)
    }

    setRecommendedMode(result.mode)
    setRecommendedValues(getAIConfigRecommendedValues(result))
    setTopologyManagedByAIConfig(true)
    setConfig(prev => applyAIConfiguratorResultToConfig(prev, result, selectedRuntime))

    toast({
      title: 'Configuration Applied',
      description: getAIConfiguratorAppliedToastDescription(result),
      variant: 'success',
    })
  }, [selectedRuntime, setConfig, toast])

  return {
    supportedBackends,
    recommendedBackend,
    recommendedMode,
    recommendedValues,
    topologyManagedByAIConfig,
    applyConfig,
    discard,
    markTopologyManuallyEdited,
    resetForRuntime,
  }
}
