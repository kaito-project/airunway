/*
Copyright 2026.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
*/

package v1alpha1

import (
	"strings"
	"testing"

	"k8s.io/apimachinery/pkg/util/validation/field"

	airunwayv1alpha1 "github.com/kaito-project/airunway/controller/api/v1alpha1"
)

func baseResourceValidationSpec() *airunwayv1alpha1.ModelDeploymentSpec {
	return &airunwayv1alpha1.ModelDeploymentSpec{
		Model: airunwayv1alpha1.ModelSpec{
			ID:     "Qwen/Qwen3-0.6B",
			Source: airunwayv1alpha1.ModelSourceHuggingFace,
		},
		Engine: airunwayv1alpha1.EngineSpec{Type: airunwayv1alpha1.EngineTypeVLLM},
	}
}

func TestValidateServingAndScaling_DisaggregatedRules(t *testing.T) {
	t.Parallel()
	specPath := field.NewPath("spec")

	tests := []struct {
		name           string
		mutate         func(*airunwayv1alpha1.ModelDeploymentSpec)
		isDynamoMocker bool
		want           string
	}{
		{
			name: "rejects aggregated GPU resources in disaggregated mode",
			mutate: func(spec *airunwayv1alpha1.ModelDeploymentSpec) {
				spec.Resources = &airunwayv1alpha1.ResourceSpec{GPU: &airunwayv1alpha1.GPUSpec{Count: 1}}
				spec.Scaling = validDisaggregatedScaling()
			},
			want: "cannot specify both resources.gpu and scaling.prefill/decode",
		},
		{
			name: "requires scaling block",
			want: "disaggregated mode requires scaling configuration",
		},
		{
			name: "requires prefill block",
			mutate: func(spec *airunwayv1alpha1.ModelDeploymentSpec) {
				spec.Scaling = &airunwayv1alpha1.ScalingSpec{Decode: componentWithGPU(1)}
			},
			want: "disaggregated mode requires scaling.prefill",
		},
		{
			name: "requires decode block",
			mutate: func(spec *airunwayv1alpha1.ModelDeploymentSpec) {
				spec.Scaling = &airunwayv1alpha1.ScalingSpec{Prefill: componentWithGPU(1)}
			},
			want: "disaggregated mode requires scaling.decode",
		},
		{
			name: "requires prefill GPU outside mocker mode",
			mutate: func(spec *airunwayv1alpha1.ModelDeploymentSpec) {
				spec.Scaling = &airunwayv1alpha1.ScalingSpec{
					Prefill: &airunwayv1alpha1.ComponentScalingSpec{Replicas: 1},
					Decode:  componentWithGPU(1),
				}
			},
			want: "disaggregated mode requires scaling.prefill.gpu.count > 0",
		},
		{
			name: "requires decode GPU outside mocker mode",
			mutate: func(spec *airunwayv1alpha1.ModelDeploymentSpec) {
				spec.Scaling = &airunwayv1alpha1.ScalingSpec{
					Prefill: componentWithGPU(1),
					Decode:  &airunwayv1alpha1.ComponentScalingSpec{Replicas: 1},
				}
			},
			want: "disaggregated mode requires scaling.decode.gpu.count > 0",
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			spec := baseResourceValidationSpec()
			if tc.mutate != nil {
				tc.mutate(spec)
			}
			errs := validateServingAndScaling(spec, specPath, airunwayv1alpha1.ServingModeDisaggregated, tc.isDynamoMocker)
			if len(errs) == 0 {
				t.Fatalf("expected validation error containing %q", tc.want)
			}
			if !strings.Contains(errs.ToAggregate().Error(), tc.want) {
				t.Fatalf("expected error containing %q, got %q", tc.want, errs.ToAggregate().Error())
			}
		})
	}
}

func TestValidateServingAndScaling_MockerWaivesComponentGPUCounts(t *testing.T) {
	t.Parallel()

	spec := baseResourceValidationSpec()
	spec.Scaling = &airunwayv1alpha1.ScalingSpec{
		Prefill: &airunwayv1alpha1.ComponentScalingSpec{Replicas: 1},
		Decode:  &airunwayv1alpha1.ComponentScalingSpec{Replicas: 1},
	}

	errs := validateServingAndScaling(spec, field.NewPath("spec"), airunwayv1alpha1.ServingModeDisaggregated, true)
	if len(errs) > 0 {
		t.Fatalf("expected mocker mode to allow missing component GPU counts, got %v", errs.ToAggregate())
	}
}

func TestValidateResourceCeilings_DirectRules(t *testing.T) {
	t.Parallel()

	spec := baseResourceValidationSpec()
	spec.Resources = &airunwayv1alpha1.ResourceSpec{
		GPU:    &airunwayv1alpha1.GPUSpec{Count: MaxGPUCount + 1},
		CPU:    "1024",
		Memory: "5Ti",
	}
	spec.Scaling = &airunwayv1alpha1.ScalingSpec{
		Replicas: MaxReplicas + 1,
		Prefill: &airunwayv1alpha1.ComponentScalingSpec{
			Replicas: MaxReplicas + 1,
			GPU:      &airunwayv1alpha1.GPUSpec{Count: MaxGPUCount + 1},
			Memory:   "5Ti",
		},
	}

	errs := validateResourceCeilings(spec, field.NewPath("spec"))
	if len(errs) < 6 {
		t.Fatalf("expected multiple resource ceiling errors, got %d: %v", len(errs), errs.ToAggregate())
	}
	for _, want := range []string{
		"spec.resources.gpu.count",
		"spec.resources.cpu",
		"spec.resources.memory",
		"spec.scaling.replicas",
		"spec.scaling.prefill.gpu.count",
		"spec.scaling.prefill.memory",
	} {
		if !strings.Contains(errs.ToAggregate().Error(), want) {
			t.Fatalf("expected error path %q in %q", want, errs.ToAggregate().Error())
		}
	}
}

func validDisaggregatedScaling() *airunwayv1alpha1.ScalingSpec {
	return &airunwayv1alpha1.ScalingSpec{
		Prefill: componentWithGPU(1),
		Decode:  componentWithGPU(1),
	}
}

func componentWithGPU(count int32) *airunwayv1alpha1.ComponentScalingSpec {
	return &airunwayv1alpha1.ComponentScalingSpec{
		Replicas: 1,
		GPU:      &airunwayv1alpha1.GPUSpec{Count: count},
	}
}
