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
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	airunwayv1alpha1 "github.com/kaito-project/airunway/controller/api/v1alpha1"
)

func storageDeployment(name string, volumes ...airunwayv1alpha1.StorageVolume) *airunwayv1alpha1.ModelDeployment {
	return &airunwayv1alpha1.ModelDeployment{
		ObjectMeta: metav1ObjectMeta(name),
		Spec: airunwayv1alpha1.ModelDeploymentSpec{
			Model: airunwayv1alpha1.ModelSpec{
				ID:      "meta-llama/Llama-2-7b-chat-hf",
				Source:  airunwayv1alpha1.ModelSourceHuggingFace,
				Storage: &airunwayv1alpha1.StorageSpec{Volumes: volumes},
			},
		},
	}
}

func metav1ObjectMeta(name string) metav1.ObjectMeta {
	return metav1.ObjectMeta{Name: name}
}

func TestValidateStorage_DirectRules(t *testing.T) {
	t.Parallel()

	sc := "fast"
	tests := []struct {
		name       string
		deployment *airunwayv1alpha1.ModelDeployment
		want       string
	}{
		{
			name: "requires claim name for existing PVC references",
			deployment: storageDeployment("demo", airunwayv1alpha1.StorageVolume{
				Name:      "cache",
				MountPath: "/model-cache",
				Purpose:   airunwayv1alpha1.VolumePurposeModelCache,
			}),
			want: "claimName is required when size is not set",
		},
		{
			name: "rejects read-only managed PVCs",
			deployment: storageDeployment("demo", airunwayv1alpha1.StorageVolume{
				Name:       "cache",
				ClaimName:  "demo-cache",
				MountPath:  "/model-cache",
				Purpose:    airunwayv1alpha1.VolumePurposeModelCache,
				Size:       quantityPtr("100Gi"),
				ReadOnly:   true,
				AccessMode: corev1.ReadWriteMany,
			}),
			want: "readOnly must not be true when size is set",
		},
		{
			name: "rejects storage class on existing PVC references",
			deployment: storageDeployment("demo", airunwayv1alpha1.StorageVolume{
				Name:             "cache",
				ClaimName:        "existing-pvc",
				MountPath:        "/model-cache",
				Purpose:          airunwayv1alpha1.VolumePurposeModelCache,
				StorageClassName: &sc,
			}),
			want: "storageClassName is only applicable when size is set",
		},
		{
			name: "rejects system mount paths",
			deployment: storageDeployment("demo", airunwayv1alpha1.StorageVolume{
				Name:      "cache",
				ClaimName: "existing-pvc",
				MountPath: "/etc/models",
				Purpose:   airunwayv1alpha1.VolumePurposeModelCache,
			}),
			want: "mountPath must not overlap with system path /etc",
		},
		{
			name: "rejects duplicate special-purpose volumes",
			deployment: storageDeployment("demo",
				airunwayv1alpha1.StorageVolume{Name: "cache-a", ClaimName: "pvc-a", MountPath: "/model-cache-a", Purpose: airunwayv1alpha1.VolumePurposeModelCache},
				airunwayv1alpha1.StorageVolume{Name: "cache-b", ClaimName: "pvc-b", MountPath: "/model-cache-b", Purpose: airunwayv1alpha1.VolumePurposeModelCache},
			),
			want: "at most one volume with purpose=modelCache is allowed",
		},
		{
			name: "rejects generated download job names over Kubernetes limit",
			deployment: storageDeployment(strings.Repeat("a", 250), airunwayv1alpha1.StorageVolume{
				Name:      "mc",
				ClaimName: strings.Repeat("a", 250) + "-mc",
				MountPath: "/model-cache",
				Purpose:   airunwayv1alpha1.VolumePurposeModelCache,
				Size:      quantityPtr("100Gi"),
			}),
			want: "download Job name",
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			errs := validateStorage(tc.deployment)
			if len(errs) == 0 {
				t.Fatalf("expected validation error containing %q", tc.want)
			}
			if !strings.Contains(errs.ToAggregate().Error(), tc.want) {
				t.Fatalf("expected error containing %q, got %q", tc.want, errs.ToAggregate().Error())
			}
		})
	}
}

func TestValidateStorage_AllowsManagedAndExistingPVCVolumes(t *testing.T) {
	t.Parallel()

	deployment := storageDeployment("demo",
		airunwayv1alpha1.StorageVolume{
			Name:       "model-cache",
			ClaimName:  "demo-model-cache",
			MountPath:  "/model-cache",
			Purpose:    airunwayv1alpha1.VolumePurposeModelCache,
			Size:       quantityPtr("100Gi"),
			AccessMode: corev1.ReadWriteMany,
		},
		airunwayv1alpha1.StorageVolume{
			Name:      "custom-data",
			ClaimName: "existing-pvc",
			MountPath: "/data",
			Purpose:   airunwayv1alpha1.VolumePurposeCustom,
		},
	)

	if errs := validateStorage(deployment); len(errs) > 0 {
		t.Fatalf("expected valid storage, got %v", errs.ToAggregate())
	}
}
