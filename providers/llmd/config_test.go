package llmd

import (
	"testing"

	airunwayv1alpha1 "github.com/kaito-project/airunway/controller/api/v1alpha1"
)

func TestGetProviderConfigSpec(t *testing.T) {
	spec := GetProviderConfigSpec()

	// Capabilities
	if spec.Capabilities == nil {
		t.Fatal("expected non-nil capabilities")
	}

	// Engines
	engines := spec.Capabilities.Engines
	if len(engines) == 0 {
		t.Fatal("expected at least one engine")
	}

	// Verify per-engine capabilities
	vllmCap := spec.Capabilities.GetEngineCapability(airunwayv1alpha1.EngineTypeVLLM)
	if vllmCap == nil {
		t.Fatal("expected vllm engine capability")
	}
	if vllmCap.RequiresCRD == nil || *vllmCap.RequiresCRD {
		t.Error("expected LLMD vllm engine to not require CRDs")
	}
	if !vllmCap.GPUSupport {
		t.Error("expected vllm GPU support to be true")
	}
	if vllmCap.CPUSupport {
		t.Error("expected vllm CPU support to be false")
	}

	// Serving modes (per-engine)
	hasAggregated := false
	hasDisaggregated := false
	for _, m := range vllmCap.ServingModes {
		if m == airunwayv1alpha1.ServingModeAggregated {
			hasAggregated = true
		}
		if m == airunwayv1alpha1.ServingModeDisaggregated {
			hasDisaggregated = true
		}
	}
	if !hasAggregated {
		t.Error("expected aggregated serving mode")
	}
	if !hasDisaggregated {
		t.Error("expected disaggregated serving mode")
	}

	// Gateway capabilities: llm-d delegates only the EPP image/config to the
	// provider; the controller still creates the InferencePool and EPP
	// scaffolding. ManagesInferencePool must remain false.
	if vllmCap.Gateway == nil {
		t.Fatal("expected non-nil Gateway capabilities on vllm engine")
	}
	if vllmCap.Gateway.ManagesInferencePool {
		t.Error("expected ManagesInferencePool to be false (llm-d does not delegate pool creation)")
	}
	if vllmCap.Gateway.InferencePoolNamePattern != "" {
		t.Errorf("expected empty InferencePoolNamePattern (llm-d does not delegate pool creation), got %q", vllmCap.Gateway.InferencePoolNamePattern)
	}
	epp := vllmCap.Gateway.EndpointPicker
	if epp == nil {
		t.Fatal("expected EndpointPicker capabilities to be set for llm-d")
	}
	if epp.Image != LLMDSchedulerImage {
		t.Errorf("expected EPP image %q, got %q", LLMDSchedulerImage, epp.Image)
	}
	if epp.ConfigData != LLMDSchedulerDefaultConfig {
		t.Error("expected EPP ConfigData to match LLMDSchedulerDefaultConfig")
	}

	// No auto-selection rules
	if len(spec.SelectionRules) != 0 {
		t.Errorf("expected no selection rules (never auto-selected), got %d", len(spec.SelectionRules))
	}
}

func TestGetInstallationInfo(t *testing.T) {
	info := GetInstallationInfo()
	if info == nil {
		t.Fatal("expected non-nil installation info")
	}
	if info.Description == "" {
		t.Error("expected non-empty description")
	}
	if len(info.Steps) == 0 {
		t.Error("expected installation steps")
	}
}

func TestProviderDocumentation(t *testing.T) {
	if ProviderDocumentation == "" {
		t.Error("expected documentation URL")
	}
}
