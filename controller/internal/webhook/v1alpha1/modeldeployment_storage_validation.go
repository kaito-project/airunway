/*
Copyright 2026.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
*/

package v1alpha1

import (
	"fmt"
	"strings"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/util/validation/field"

	airunwayv1alpha1 "github.com/kaito-project/airunway/controller/api/v1alpha1"
)

// storageVolumeEqual compares two StorageVolumes semantically. It uses
// resource.Quantity.Cmp for Size rather than reflect.DeepEqual, because
// Quantity carries unexported state (cached string form, format) that can
// differ between two semantically equivalent values (e.g. "1Gi" vs "1024Mi",
// or one Quantity that has had String() called and one that hasn't).
func storageVolumeEqual(a, b *airunwayv1alpha1.StorageVolume) bool {
	if a == nil || b == nil {
		return a == b
	}
	if a.Name != b.Name ||
		a.ClaimName != b.ClaimName ||
		a.MountPath != b.MountPath ||
		a.Purpose != b.Purpose ||
		a.ReadOnly != b.ReadOnly ||
		a.AccessMode != b.AccessMode {
		return false
	}
	// StorageClassName is a *string
	switch {
	case a.StorageClassName == nil && b.StorageClassName == nil:
	case a.StorageClassName == nil || b.StorageClassName == nil:
		return false
	case *a.StorageClassName != *b.StorageClassName:
		return false
	}
	// Size is a *resource.Quantity — compare by value, not by DeepEqual.
	switch {
	case a.Size == nil && b.Size == nil:
	case a.Size == nil || b.Size == nil:
		return false
	case a.Size.Cmp(*b.Size) != 0:
		return false
	}
	return true
}

// validateStorage validates the model storage configuration
func validateStorage(obj *airunwayv1alpha1.ModelDeployment) field.ErrorList {
	var allErrs field.ErrorList
	storage := obj.Spec.Model.Storage

	if storage == nil || len(storage.Volumes) == 0 {
		return allErrs
	}

	storagePath := field.NewPath("spec", "model", "storage", "volumes")

	// System paths that cannot be used as mount points
	systemPaths := []string{"/dev", "/proc", "/sys", "/etc", "/var/run"}

	namesSeen := map[string]bool{}
	mountPathsSeen := map[string]bool{}
	claimNamesSeen := map[string]bool{}
	modelCacheCount := 0
	compilationCacheCount := 0
	hasManagedModelCache := false

	for i, vol := range storage.Volumes {
		volPath := storagePath.Index(i)

		// When size is NOT set, claimName is required (pre-existing PVC reference mode)
		if vol.Size == nil && vol.ClaimName == "" {
			allErrs = append(allErrs, field.Required(
				volPath.Child("claimName"),
				"claimName is required when size is not set (must reference a pre-existing PVC)",
			))
		}

		// Reject readOnly with size set (controller-created PVC shouldn't be read-only from the start)
		if vol.Size != nil && vol.ReadOnly {
			allErrs = append(allErrs, field.Invalid(
				volPath.Child("readOnly"),
				vol.ReadOnly,
				"readOnly must not be true when size is set (controller-created PVCs need write access)",
			))
		}

		// When size is set, claimName must match the auto-generated pattern <md-name>-<vol-name>.
		// The mutating webhook defaults claimName when empty, so by validation time it's always populated.
		// An arbitrary claimName with size could cause the reconciler to delete an unrelated PVC.
		if vol.Size != nil && vol.ClaimName != "" {
			expectedClaimName := fmt.Sprintf("%s-%s", obj.Name, vol.Name)
			if vol.ClaimName != expectedClaimName {
				allErrs = append(allErrs, field.Invalid(
					volPath.Child("claimName"),
					vol.ClaimName,
					fmt.Sprintf("claimName must not be set when size is set (auto-generated as %q)", expectedClaimName),
				))
			}
		}

		// Validate that the auto-generated claim name does not exceed the
		// Kubernetes DNS subdomain limit (253 chars).
		if vol.Size != nil {
			claimName := vol.ResolvedClaimName(obj.Name)
			if len(claimName) > 253 {
				allErrs = append(allErrs, field.Invalid(
					volPath.Child("name"),
					vol.Name,
					fmt.Sprintf(
						"auto-generated PVC claim name %q exceeds the 253-character Kubernetes name limit (got %d characters); use a shorter ModelDeployment or volume name",
						claimName, len(claimName)),
				))
			}
		}

		// Validate accessMode if set
		if vol.AccessMode != "" {
			switch vol.AccessMode {
			case corev1.ReadWriteOnce, corev1.ReadWriteMany, corev1.ReadOnlyMany, corev1.ReadWriteOncePod:
				// valid
			default:
				allErrs = append(allErrs, field.NotSupported(
					volPath.Child("accessMode"),
					vol.AccessMode,
					[]string{
						string(corev1.ReadWriteOnce),
						string(corev1.ReadWriteMany),
						string(corev1.ReadOnlyMany),
						string(corev1.ReadWriteOncePod),
					},
				))
			}

			// accessMode is only meaningful when size is set
			if vol.Size == nil {
				allErrs = append(allErrs, field.Invalid(
					volPath.Child("accessMode"),
					vol.AccessMode,
					"accessMode is only applicable when size is set (controller-created PVCs)",
				))
			}
		}

		// storageClassName is only meaningful when size is set
		if vol.StorageClassName != nil && vol.Size == nil {
			allErrs = append(allErrs, field.Invalid(
				volPath.Child("storageClassName"),
				*vol.StorageClassName,
				"storageClassName is only applicable when size is set (controller-created PVCs)",
			))
		}

		// Check duplicate names
		if namesSeen[vol.Name] {
			allErrs = append(allErrs, field.Invalid(
				volPath.Child("name"),
				vol.Name,
				"duplicate volume name",
			))
		}
		namesSeen[vol.Name] = true

		// Check duplicate mountPaths
		if vol.MountPath != "" {
			if mountPathsSeen[vol.MountPath] {
				allErrs = append(allErrs, field.Invalid(
					volPath.Child("mountPath"),
					vol.MountPath,
					"duplicate mount path",
				))
			}
			mountPathsSeen[vol.MountPath] = true
		}

		// Check duplicate claimNames (only if claimName is set)
		if vol.ClaimName != "" {
			if claimNamesSeen[vol.ClaimName] {
				allErrs = append(allErrs, field.Invalid(
					volPath.Child("claimName"),
					vol.ClaimName,
					"duplicate claim name",
				))
			}
			claimNamesSeen[vol.ClaimName] = true
		}

		// mountPath must be absolute
		if vol.MountPath != "" && !strings.HasPrefix(vol.MountPath, "/") {
			allErrs = append(allErrs, field.Invalid(
				volPath.Child("mountPath"),
				vol.MountPath,
				"mountPath must be an absolute path (start with /)",
			))
		}

		// custom purpose requires explicit mountPath
		if vol.Purpose == airunwayv1alpha1.VolumePurposeCustom && vol.MountPath == "" {
			allErrs = append(allErrs, field.Required(
				volPath.Child("mountPath"),
				"mountPath is required when purpose is custom",
			))
		}

		// Reject system paths
		for _, sysPath := range systemPaths {
			if vol.MountPath == sysPath || strings.HasPrefix(vol.MountPath, sysPath+"/") {
				allErrs = append(allErrs, field.Invalid(
					volPath.Child("mountPath"),
					vol.MountPath,
					fmt.Sprintf("mountPath must not overlap with system path %s", sysPath),
				))
				break
			}
		}

		// Count purposes
		switch vol.Purpose {
		case airunwayv1alpha1.VolumePurposeModelCache:
			modelCacheCount++
			if vol.Size != nil && !vol.ReadOnly {
				hasManagedModelCache = true
			}
		case airunwayv1alpha1.VolumePurposeCompilationCache:
			compilationCacheCount++
		}
	}

	// At most one modelCache volume
	if modelCacheCount > 1 {
		allErrs = append(allErrs, field.Invalid(
			storagePath,
			modelCacheCount,
			"at most one volume with purpose=modelCache is allowed",
		))
	}

	// At most one compilationCache volume
	if compilationCacheCount > 1 {
		allErrs = append(allErrs, field.Invalid(
			storagePath,
			compilationCacheCount,
			"at most one volume with purpose=compilationCache is allowed",
		))
	}

	// Validate that the auto-generated download job name fits within
	// the 253-character Kubernetes name limit.
	// The download job name is <md-name>-model-download (15-char suffix).
	downloadJobName := obj.Name + "-model-download"
	if hasManagedModelCache && len(downloadJobName) > 253 {
		allErrs = append(allErrs, field.Invalid(
			field.NewPath("metadata", "name"),
			obj.Name,
			fmt.Sprintf(
				"auto-generated download Job name %q exceeds the 253-character Kubernetes name limit (got %d characters); use a shorter ModelDeployment name",
				downloadJobName, len(downloadJobName)),
		))
	}

	return allErrs
}
