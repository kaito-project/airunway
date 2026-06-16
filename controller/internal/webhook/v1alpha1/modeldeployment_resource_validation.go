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

	"k8s.io/apimachinery/pkg/api/resource"
	"k8s.io/apimachinery/pkg/util/validation/field"

	airunwayv1alpha1 "github.com/kaito-project/airunway/controller/api/v1alpha1"
)

func validateServingAndScaling(
	spec *airunwayv1alpha1.ModelDeploymentSpec,
	specPath *field.Path,
	servingMode airunwayv1alpha1.ServingMode,
	isDynamoMocker bool,
) field.ErrorList {
	var allErrs field.ErrorList
	if servingMode != airunwayv1alpha1.ServingModeDisaggregated {
		return allErrs
	}

	// Cannot specify resources.gpu in disaggregated mode
	if spec.Resources != nil && spec.Resources.GPU != nil && spec.Resources.GPU.Count > 0 {
		allErrs = append(allErrs, field.Invalid(
			specPath.Child("resources", "gpu"),
			spec.Resources.GPU,
			"cannot specify both resources.gpu and scaling.prefill/decode in disaggregated mode",
		))
	}

	// Must specify prefill and decode
	if spec.Scaling == nil {
		allErrs = append(allErrs, field.Required(
			specPath.Child("scaling"),
			"disaggregated mode requires scaling configuration",
		))
		return allErrs
	}

	if spec.Scaling.Prefill == nil {
		allErrs = append(allErrs, field.Required(
			specPath.Child("scaling", "prefill"),
			"disaggregated mode requires scaling.prefill",
		))
	} else if !isDynamoMocker {
		// Mocker mode runs the GPU-less python3 -m dynamo.mocker backend,
		// so a CPU-only disaggregated mocker deployment legitimately omits
		// scaling.prefill.gpu.count. The prefill block itself is still
		// required (above) so the dynamo transformer can build the worker.
		if spec.Scaling.Prefill.GPU == nil || spec.Scaling.Prefill.GPU.Count == 0 {
			allErrs = append(allErrs, field.Required(
				specPath.Child("scaling", "prefill", "gpu", "count"),
				"disaggregated mode requires scaling.prefill.gpu.count > 0",
			))
		}
	}

	if spec.Scaling.Decode == nil {
		allErrs = append(allErrs, field.Required(
			specPath.Child("scaling", "decode"),
			"disaggregated mode requires scaling.decode",
		))
	} else if !isDynamoMocker {
		// See the prefill note above: mocker mode waives the GPU-count
		// requirement while still requiring the decode block.
		if spec.Scaling.Decode.GPU == nil || spec.Scaling.Decode.GPU.Count == 0 {
			allErrs = append(allErrs, field.Required(
				specPath.Child("scaling", "decode", "gpu", "count"),
				"disaggregated mode requires scaling.decode.gpu.count > 0",
			))
		}
	}

	return allErrs
}

// validateResourceCeilings enforces the Max* limits on resource and scaling fields.
func validateResourceCeilings(spec *airunwayv1alpha1.ModelDeploymentSpec, specPath *field.Path) field.ErrorList {
	var allErrs field.ErrorList

	if spec.Resources != nil {
		resPath := specPath.Child("resources")
		if spec.Resources.GPU != nil && spec.Resources.GPU.Count > MaxGPUCount {
			allErrs = append(allErrs, field.Invalid(
				resPath.Child("gpu", "count"),
				spec.Resources.GPU.Count,
				fmt.Sprintf("exceeds maximum allowed (%d)", MaxGPUCount),
			))
		}
		allErrs = append(allErrs, validateResourceQuantity(spec.Resources.CPU, MaxCPU, resPath.Child("cpu"))...)
		allErrs = append(allErrs, validateResourceQuantity(spec.Resources.Memory, MaxMemory, resPath.Child("memory"))...)
	}

	if spec.Scaling != nil {
		scalingPath := specPath.Child("scaling")
		if spec.Scaling.Replicas > MaxReplicas {
			allErrs = append(allErrs, field.Invalid(
				scalingPath.Child("replicas"),
				spec.Scaling.Replicas,
				fmt.Sprintf("exceeds maximum allowed (%d)", MaxReplicas),
			))
		}
		allErrs = append(allErrs, validateComponentCeilings(spec.Scaling.Prefill, scalingPath.Child("prefill"))...)
		allErrs = append(allErrs, validateComponentCeilings(spec.Scaling.Decode, scalingPath.Child("decode"))...)
	}

	return allErrs
}

// validateComponentCeilings enforces ceilings on a prefill/decode component.
func validateComponentCeilings(comp *airunwayv1alpha1.ComponentScalingSpec, compPath *field.Path) field.ErrorList {
	var allErrs field.ErrorList
	if comp == nil {
		return allErrs
	}
	if comp.Replicas > MaxReplicas {
		allErrs = append(allErrs, field.Invalid(
			compPath.Child("replicas"),
			comp.Replicas,
			fmt.Sprintf("exceeds maximum allowed (%d)", MaxReplicas),
		))
	}
	if comp.GPU != nil && comp.GPU.Count > MaxGPUCount {
		allErrs = append(allErrs, field.Invalid(
			compPath.Child("gpu", "count"),
			comp.GPU.Count,
			fmt.Sprintf("exceeds maximum allowed (%d)", MaxGPUCount),
		))
	}
	allErrs = append(allErrs, validateResourceQuantity(comp.Memory, MaxMemory, compPath.Child("memory"))...)
	return allErrs
}

// validateResourceQuantity validates that a resource string doesn't exceed a maximum
func validateResourceQuantity(value string, max string, fldPath *field.Path) field.ErrorList {
	var allErrs field.ErrorList
	if value == "" {
		return allErrs
	}
	qty, err := resource.ParseQuantity(value)
	if err != nil {
		allErrs = append(allErrs, field.Invalid(fldPath, value, "invalid resource quantity"))
		return allErrs
	}
	maxQty := resource.MustParse(max)
	if qty.Cmp(maxQty) > 0 {
		allErrs = append(allErrs, field.Invalid(fldPath, value, fmt.Sprintf("exceeds maximum allowed (%s)", max)))
	}
	return allErrs
}
