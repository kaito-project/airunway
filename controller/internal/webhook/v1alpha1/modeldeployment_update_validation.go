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

	"k8s.io/apimachinery/pkg/util/validation/field"

	airunwayv1alpha1 "github.com/kaito-project/airunway/controller/api/v1alpha1"
)

// validateImmutableFields checks if any immutable (identity) fields have been changed
// Changing these fields triggers a delete+recreate of the provider resource
func (v *ModelDeploymentCustomValidator) validateImmutableFields(oldObj, newObj *airunwayv1alpha1.ModelDeployment) field.ErrorList {
	var allErrs field.ErrorList
	specPath := field.NewPath("spec")

	oldSpec := &oldObj.Spec
	newSpec := &newObj.Spec

	// model.id is an identity field
	if oldSpec.Model.ID != newSpec.Model.ID {
		allErrs = append(allErrs, field.Invalid(
			specPath.Child("model", "id"),
			newSpec.Model.ID,
			"model.id is immutable (changing it requires delete and recreate)",
		))
	}

	// model.source is an identity field
	if oldSpec.Model.Source != newSpec.Model.Source {
		allErrs = append(allErrs, field.Invalid(
			specPath.Child("model", "source"),
			newSpec.Model.Source,
			"model.source is immutable (changing it requires delete and recreate)",
		))
	}

	// engine.type is an identity field (once set)
	if oldSpec.Engine.Type != "" && newSpec.Engine.Type != "" && oldSpec.Engine.Type != newSpec.Engine.Type {
		allErrs = append(allErrs, field.Invalid(
			specPath.Child("engine", "type"),
			newSpec.Engine.Type,
			"engine.type is immutable (changing it requires delete and recreate)",
		))
	}

	// provider.name is an identity field (once set)
	oldProvider := ""
	newProvider := ""
	if oldSpec.Provider != nil {
		oldProvider = oldSpec.Provider.Name
	}
	if newSpec.Provider != nil {
		newProvider = newSpec.Provider.Name
	}
	if oldProvider != "" && newProvider != "" && oldProvider != newProvider {
		allErrs = append(allErrs, field.Invalid(
			specPath.Child("provider", "name"),
			newProvider,
			"provider.name is immutable (changing it requires delete and recreate)",
		))
	}

	// serving.mode is an identity field
	oldMode := airunwayv1alpha1.ServingModeAggregated
	newMode := airunwayv1alpha1.ServingModeAggregated
	if oldSpec.Serving != nil && oldSpec.Serving.Mode != "" {
		oldMode = oldSpec.Serving.Mode
	}
	if newSpec.Serving != nil && newSpec.Serving.Mode != "" {
		newMode = newSpec.Serving.Mode
	}
	if oldMode != newMode {
		allErrs = append(allErrs, field.Invalid(
			specPath.Child("serving", "mode"),
			newMode,
			"serving.mode is immutable (changing it requires delete and recreate)",
		))
	}

	// Storage volumes are immutable once a managed PVC is created.
	// Only applies to managed volumes (size != nil) that existed in the old spec.
	// Two bypass scenarios are prevented:
	// 1. Dropping a managed volume from the list (would orphan its PVC)
	// 2. Setting model.storage to nil (would orphan all managed PVCs)
	oldManagedVolumes := make(map[string]airunwayv1alpha1.StorageVolume)
	if oldSpec.Model.Storage != nil {
		for _, vol := range oldSpec.Model.Storage.Volumes {
			if vol.Size != nil {
				oldManagedVolumes[vol.Name] = vol
			}
		}
	}

	if len(oldManagedVolumes) > 0 {
		storagePath := specPath.Child("model", "storage", "volumes")

		// Build a set of new volume names for quick lookup
		newVolumeNames := make(map[string]bool)
		if newSpec.Model.Storage != nil {
			for _, vol := range newSpec.Model.Storage.Volumes {
				newVolumeNames[vol.Name] = true
			}
		}

		// Pass 1 — detect removals: reject any old managed volume not present in the new spec
		for _, oldVol := range oldManagedVolumes {
			if !newVolumeNames[oldVol.Name] {
				allErrs = append(allErrs, field.Forbidden(
					storagePath,
					fmt.Sprintf("managed storage volume %q cannot be removed (it has an associated PVC; delete the ModelDeployment to clean up managed storage)", oldVol.Name),
				))
			}
		}

		// Pass 2 — detect modifications: reject any change to an existing managed volume
		if newSpec.Model.Storage != nil {
			for i, newVol := range newSpec.Model.Storage.Volumes {
				oldVol, exists := oldManagedVolumes[newVol.Name]
				if !exists {
					continue
				}
				if !storageVolumeEqual(&oldVol, &newVol) {
					volPath := storagePath.Index(i)
					allErrs = append(allErrs, field.Invalid(
						volPath,
						newVol.Name,
						"managed storage volume is immutable once created (delete the ModelDeployment to change managed storage configuration)",
					))
				}
			}
		}
	}

	return allErrs
}
