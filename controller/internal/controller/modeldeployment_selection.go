/*
Copyright 2026.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
*/

package controller

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/google/cel-go/cel"
	"github.com/google/cel-go/common/types"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/controller-runtime/pkg/log"

	airunwayv1alpha1 "github.com/kaito-project/airunway/controller/api/v1alpha1"
)

// celEnvOnce lazily initializes a shared CEL environment for evaluating selection rules.
// The environment is safe to share across goroutines since it only declares the "spec" variable.
var (
	celEnvOnce sync.Once
	celEnvInst *cel.Env
	celEnvErr  error
)

func getCELEnv() (*cel.Env, error) {
	celEnvOnce.Do(func() {
		celEnvInst, celEnvErr = cel.NewEnv(
			cel.Variable("spec", cel.DynType),
		)
	})
	return celEnvInst, celEnvErr
}

// selectEngine auto-selects the engine type from provider capabilities if not specified
func (r *ModelDeploymentReconciler) selectEngine(ctx context.Context, md *airunwayv1alpha1.ModelDeployment, providerConfigs []airunwayv1alpha1.InferenceProviderConfig, servingMode airunwayv1alpha1.ServingMode) error {
	logger := log.FromContext(ctx)

	// If engine type is explicitly specified, just record it in status.
	// The EngineSelected=True condition is intentionally NOT set here — it is
	// only flipped True after downstream provider-compatibility validation
	// passes (see Reconcile), so the condition reflects "selected AND usable"
	// rather than "selected but possibly incompatible".
	if md.Spec.Engine.Type != "" {
		md.Status.Engine = &airunwayv1alpha1.EngineStatus{
			Type:           md.Spec.Engine.Type,
			SelectedReason: "explicit engine selection",
		}
		return nil
	}

	// Skip if engine already auto-selected
	if md.Status.Engine != nil && md.Status.Engine.Type != "" {
		return nil
	}

	if len(providerConfigs) == 0 {
		return fmt.Errorf("no providers registered (InferenceProviderConfig resources not found)")
	}

	// Collect supported engines from ready providers, filtering by per-engine compatibility
	// Determine deployment characteristics
	hasGPU := false
	if md.Spec.Resources != nil && md.Spec.Resources.GPU != nil && md.Spec.Resources.GPU.Count > 0 {
		hasGPU = true
	}
	if md.Spec.Serving != nil && md.Spec.Serving.Mode == airunwayv1alpha1.ServingModeDisaggregated {
		hasGPU = true
	}

	availableEngines := make(map[airunwayv1alpha1.EngineType]string)    // engine -> provider name
	advertisedEngines := make(map[string][]airunwayv1alpha1.EngineType) // provider name -> engines advertised

	for _, pc := range providerConfigs {
		if !pc.Status.Ready || pc.Spec.Capabilities == nil {
			continue
		}

		caps := pc.Spec.Capabilities
		advertisedEngines[pc.Name] = caps.EngineNames()

		for _, engineCap := range caps.Engines {
			// Filter by GPU/CPU compatibility at the engine level
			if hasGPU && !engineCap.GPUSupport {
				continue
			}
			if !hasGPU && !engineCap.CPUSupport {
				continue
			}

			// Filter by serving mode compatibility at the engine level
			if !engineCap.SupportsServingMode(servingMode) {
				continue
			}

			if _, exists := availableEngines[engineCap.Name]; !exists {
				availableEngines[engineCap.Name] = pc.Name
			}
		}
	}

	if len(availableEngines) == 0 {
		logger.Info("No engines available after filtering",
			"hasGPU", hasGPU,
			"servingMode", servingMode,
			"advertisedByProvider", advertisedEngines)
		return fmt.Errorf("no engines available from registered providers (hasGPU=%v, servingMode=%s, advertised=%v)", hasGPU, servingMode, advertisedEngines)
	}

	// Select the highest-preference engine that is available
	enginePreference := []airunwayv1alpha1.EngineType{
		airunwayv1alpha1.EngineTypeVLLM,
		airunwayv1alpha1.EngineTypeSGLang,
		airunwayv1alpha1.EngineTypeTRTLLM,
		airunwayv1alpha1.EngineTypeLlamaCpp,
	}
	for _, engine := range enginePreference {
		if providerName, ok := availableEngines[engine]; ok {
			logger.Info("Engine auto-selected", "engine", engine, "fromProvider", providerName)
			md.Status.Engine = &airunwayv1alpha1.EngineStatus{
				Type:           engine,
				SelectedReason: fmt.Sprintf("auto-selected from provider %s capabilities", providerName),
			}
			// EngineSelected=True is set in Reconcile after provider-compatibility
			// validation passes; see comment on the explicit-selection branch above.
			return nil
		}
	}

	// Unreachable in practice: enginePreference enumerates every EngineType
	// constant and availableEngines is keyed by that same set, so the loop
	// above always returns when len(availableEngines) > 0. Surface a clear
	// error if a future EngineType is added without updating enginePreference.
	return fmt.Errorf("no engine in preference list matches available engines %v (enginePreference may be missing a newly added EngineType)", availableEngines)
}

// selectProvider runs the provider selection algorithm
func (r *ModelDeploymentReconciler) selectProvider(ctx context.Context, md *airunwayv1alpha1.ModelDeployment, providerConfigs []airunwayv1alpha1.InferenceProviderConfig, resolvedEngineType airunwayv1alpha1.EngineType, resolvedServingMode airunwayv1alpha1.ServingMode) error {
	logger := log.FromContext(ctx)

	// Skip if provider is already selected (either in spec or status)
	if md.Spec.Provider != nil && md.Spec.Provider.Name != "" {
		return nil // User explicitly specified provider
	}
	if md.Status.Provider != nil && md.Status.Provider.Name != "" {
		return nil // Provider already selected
	}

	if len(providerConfigs) == 0 {
		return fmt.Errorf("no providers registered (InferenceProviderConfig resources not found)")
	}

	// Filter to ready providers
	var readyProviders []airunwayv1alpha1.InferenceProviderConfig
	for _, pc := range providerConfigs {
		if pc.Status.Ready {
			readyProviders = append(readyProviders, pc)
		}
	}

	if len(readyProviders) == 0 {
		return fmt.Errorf("no healthy providers available")
	}

	// Run selection algorithm
	selectedProvider, reason, err := r.runSelectionAlgorithm(md, readyProviders, resolvedEngineType, resolvedServingMode)
	if err != nil {
		return fmt.Errorf("provider selection failed: %w", err)
	}
	if selectedProvider == "" {
		return fmt.Errorf("no compatible provider found for this configuration")
	}

	logger.Info("Provider selected", "provider", selectedProvider, "reason", reason)

	md.Status.Provider = &airunwayv1alpha1.ProviderStatus{
		Name:           selectedProvider,
		SelectedReason: reason,
	}
	r.setCondition(md, airunwayv1alpha1.ConditionTypeProviderSelected, metav1.ConditionTrue, "AutoSelected", fmt.Sprintf("Provider %s auto-selected", selectedProvider))

	return nil
}

// runSelectionAlgorithm implements the provider selection algorithm
func (r *ModelDeploymentReconciler) runSelectionAlgorithm(md *airunwayv1alpha1.ModelDeployment, providers []airunwayv1alpha1.InferenceProviderConfig, engineType airunwayv1alpha1.EngineType, servingMode airunwayv1alpha1.ServingMode) (string, string, error) {
	spec := &md.Spec

	// Determine GPU requirements
	hasGPU := false
	if spec.Resources != nil && spec.Resources.GPU != nil && spec.Resources.GPU.Count > 0 {
		hasGPU = true
	}
	if spec.Serving != nil && spec.Serving.Mode == airunwayv1alpha1.ServingModeDisaggregated {
		hasGPU = true
	}

	// Convert spec to map for CEL evaluation.
	specMap, err := specToMap(spec)
	if err != nil {
		return "", "", fmt.Errorf("failed to convert spec for CEL evaluation: %w", err)
	}

	// Overlay the resolved engine type so CEL rules like `spec.engine.type == 'vllm'`
	// see the auto-selected engine even though md.Spec was never mutated.
	if engineType != "" {
		engineMap, _ := specMap["engine"].(map[string]any)
		if engineMap == nil {
			engineMap = map[string]any{}
			specMap["engine"] = engineMap
		}
		if t, _ := engineMap["type"].(string); t == "" {
			engineMap["type"] = string(engineType)
		}
	}

	// Build candidate list with scores
	type candidate struct {
		name     string
		reason   string
		priority int32
	}
	var candidates []candidate

	for _, pc := range providers {
		caps := pc.Spec.Capabilities
		if caps == nil {
			continue
		}

		// Check engine support and get per-engine capabilities
		engineCap := caps.GetEngineCapability(engineType)
		if engineCap == nil {
			continue
		}

		// Check GPU/CPU support for this specific engine
		if hasGPU && !engineCap.GPUSupport {
			continue
		}
		if !hasGPU && !engineCap.CPUSupport {
			continue
		}

		// Check serving mode support for this specific engine
		if !engineCap.SupportsServingMode(servingMode) {
			continue
		}

		// This provider is compatible
		// Evaluate CEL selection rules to calculate priority
		priority := int32(0)
		for _, rule := range pc.Spec.SelectionRules {
			matched, err := evaluateCEL(rule.Condition, specMap)
			if err != nil {
				continue // skip rules that fail to evaluate
			}
			if matched && rule.Priority > priority {
				priority = rule.Priority
			}
		}

		reason := fmt.Sprintf("matched capabilities: engine=%s, gpu=%v, mode=%s", engineType, hasGPU, servingMode)
		candidates = append(candidates, candidate{
			name:     pc.Name,
			reason:   reason,
			priority: priority,
		})
	}

	if len(candidates) == 0 {
		return "", "", nil
	}

	// Select highest priority candidate; use name as stable tiebreaker
	best := candidates[0]
	for _, c := range candidates[1:] {
		if c.priority > best.priority || (c.priority == best.priority && c.name < best.name) {
			best = c
		}
	}

	return best.name, best.reason, nil
}

// specToMap converts a ModelDeploymentSpec to a map for CEL evaluation
func specToMap(spec *airunwayv1alpha1.ModelDeploymentSpec) (map[string]any, error) {
	data, err := json.Marshal(spec)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal spec: %w", err)
	}
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, fmt.Errorf("failed to unmarshal spec: %w", err)
	}
	return m, nil
}

// evaluateCEL evaluates a CEL expression against the spec map
func evaluateCEL(expression string, specMap map[string]any) (bool, error) {
	env, err := getCELEnv()
	if err != nil {
		return false, fmt.Errorf("failed to create CEL environment: %w", err)
	}

	ast, issues := env.Compile(expression)
	if issues != nil && issues.Err() != nil {
		return false, fmt.Errorf("failed to compile CEL expression %q: %w", expression, issues.Err())
	}

	prg, err := env.Program(ast)
	if err != nil {
		return false, fmt.Errorf("failed to create CEL program: %w", err)
	}

	out, _, err := prg.Eval(map[string]any{
		"spec": specMap,
	})
	if err != nil {
		return false, fmt.Errorf("failed to evaluate CEL expression: %w", err)
	}

	if out.Type() != types.BoolType {
		return false, fmt.Errorf("CEL expression did not return bool, got %s", out.Type())
	}

	return out.Value().(bool), nil
}
