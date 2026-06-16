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

	corev1 "k8s.io/api/core/v1"

	airunwayv1alpha1 "github.com/kaito-project/airunway/controller/api/v1alpha1"
)

func updateValidationDeployment() *airunwayv1alpha1.ModelDeployment {
	return &airunwayv1alpha1.ModelDeployment{
		Spec: airunwayv1alpha1.ModelDeploymentSpec{
			Model: airunwayv1alpha1.ModelSpec{
				ID:     "Qwen/Qwen3-0.6B",
				Source: airunwayv1alpha1.ModelSourceHuggingFace,
			},
			Engine:   airunwayv1alpha1.EngineSpec{Type: airunwayv1alpha1.EngineTypeVLLM},
			Provider: &airunwayv1alpha1.ProviderSpec{Name: "dynamo"},
			Serving:  &airunwayv1alpha1.ServingSpec{Mode: airunwayv1alpha1.ServingModeAggregated},
		},
	}
}

func TestValidateImmutableFields_IdentityFields(t *testing.T) {
	t.Parallel()
	validator := &ModelDeploymentCustomValidator{}

	tests := []struct {
		name   string
		mutate func(*airunwayv1alpha1.ModelDeployment)
		want   string
	}{
		{
			name: "model id",
			mutate: func(md *airunwayv1alpha1.ModelDeployment) {
				md.Spec.Model.ID = "Qwen/Qwen3-8B"
			},
			want: "model.id is immutable",
		},
		{
			name: "model source",
			mutate: func(md *airunwayv1alpha1.ModelDeployment) {
				md.Spec.Model.Source = airunwayv1alpha1.ModelSourceCustom
			},
			want: "model.source is immutable",
		},
		{
			name: "engine type",
			mutate: func(md *airunwayv1alpha1.ModelDeployment) {
				md.Spec.Engine.Type = airunwayv1alpha1.EngineTypeSGLang
			},
			want: "engine.type is immutable",
		},
		{
			name: "provider name",
			mutate: func(md *airunwayv1alpha1.ModelDeployment) {
				md.Spec.Provider.Name = "kuberay"
			},
			want: "provider.name is immutable",
		},
		{
			name: "serving mode",
			mutate: func(md *airunwayv1alpha1.ModelDeployment) {
				md.Spec.Serving.Mode = airunwayv1alpha1.ServingModeDisaggregated
			},
			want: "serving.mode is immutable",
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			oldObj := updateValidationDeployment()
			newObj := updateValidationDeployment()
			tc.mutate(newObj)

			errs := validator.validateImmutableFields(oldObj, newObj)
			if len(errs) == 0 {
				t.Fatalf("expected immutable field error containing %q", tc.want)
			}
			if !strings.Contains(errs.ToAggregate().Error(), tc.want) {
				t.Fatalf("expected error containing %q, got %q", tc.want, errs.ToAggregate().Error())
			}
		})
	}
}

func TestValidateImmutableFields_AllowsInitiallyEmptyEngineAndProvider(t *testing.T) {
	t.Parallel()
	validator := &ModelDeploymentCustomValidator{}
	oldObj := updateValidationDeployment()
	oldObj.Spec.Engine.Type = ""
	oldObj.Spec.Provider = nil
	newObj := updateValidationDeployment()
	newObj.Spec.Engine.Type = airunwayv1alpha1.EngineTypeSGLang
	newObj.Spec.Provider = &airunwayv1alpha1.ProviderSpec{Name: "kuberay"}

	if errs := validator.validateImmutableFields(oldObj, newObj); len(errs) > 0 {
		t.Fatalf("expected initially empty engine/provider to be set, got %v", errs.ToAggregate())
	}
}

func TestValidateImmutableFields_ManagedStorage(t *testing.T) {
	t.Parallel()
	validator := &ModelDeploymentCustomValidator{}
	size := quantityPtr("100Gi")
	managed := airunwayv1alpha1.StorageVolume{
		Name:       "model-cache",
		ClaimName:  "demo-model-cache",
		MountPath:  "/model-cache",
		Purpose:    airunwayv1alpha1.VolumePurposeModelCache,
		Size:       size,
		AccessMode: corev1.ReadWriteMany,
	}

	t.Run("rejects removal", func(t *testing.T) {
		oldObj := updateValidationDeployment()
		oldObj.Spec.Model.Storage = &airunwayv1alpha1.StorageSpec{Volumes: []airunwayv1alpha1.StorageVolume{managed}}
		newObj := updateValidationDeployment()
		newObj.Spec.Model.Storage = &airunwayv1alpha1.StorageSpec{Volumes: []airunwayv1alpha1.StorageVolume{}}

		errs := validator.validateImmutableFields(oldObj, newObj)
		if len(errs) == 0 || !strings.Contains(errs.ToAggregate().Error(), "cannot be removed") {
			t.Fatalf("expected managed volume removal error, got %v", errs.ToAggregate())
		}
	})

	t.Run("rejects modifications", func(t *testing.T) {
		oldObj := updateValidationDeployment()
		oldObj.Spec.Model.Storage = &airunwayv1alpha1.StorageSpec{Volumes: []airunwayv1alpha1.StorageVolume{managed}}
		newObj := updateValidationDeployment()
		changed := managed
		changed.MountPath = "/other-cache"
		newObj.Spec.Model.Storage = &airunwayv1alpha1.StorageSpec{Volumes: []airunwayv1alpha1.StorageVolume{changed}}

		errs := validator.validateImmutableFields(oldObj, newObj)
		if len(errs) == 0 || !strings.Contains(errs.ToAggregate().Error(), "managed storage volume is immutable") {
			t.Fatalf("expected managed volume modification error, got %v", errs.ToAggregate())
		}
	})

	t.Run("allows unmanaged volume changes", func(t *testing.T) {
		oldObj := updateValidationDeployment()
		oldObj.Spec.Model.Storage = &airunwayv1alpha1.StorageSpec{Volumes: []airunwayv1alpha1.StorageVolume{{
			Name: "custom", ClaimName: "existing-a", MountPath: "/data", Purpose: airunwayv1alpha1.VolumePurposeCustom,
		}}}
		newObj := updateValidationDeployment()
		newObj.Spec.Model.Storage = &airunwayv1alpha1.StorageSpec{Volumes: []airunwayv1alpha1.StorageVolume{{
			Name: "custom", ClaimName: "existing-b", MountPath: "/other", Purpose: airunwayv1alpha1.VolumePurposeCustom,
		}}}

		if errs := validator.validateImmutableFields(oldObj, newObj); len(errs) > 0 {
			t.Fatalf("expected unmanaged storage changes to be allowed, got %v", errs.ToAggregate())
		}
	})
}
