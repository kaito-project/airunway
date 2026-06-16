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

	"sigs.k8s.io/controller-runtime/pkg/webhook/admission"

	airunwayv1alpha1 "github.com/kaito-project/airunway/controller/api/v1alpha1"
)

// checkWarnings returns non-fatal warnings for the spec
func (v *ModelDeploymentCustomValidator) checkWarnings(obj *airunwayv1alpha1.ModelDeployment) admission.Warnings {
	var warnings admission.Warnings
	spec := &obj.Spec

	// Warn if servedName is specified with custom source
	if spec.Model.Source == airunwayv1alpha1.ModelSourceCustom && spec.Model.ServedName != "" {
		warnings = append(warnings, "servedName is ignored for custom source (model name is defined by the container)")
	}

	// Warn if trustRemoteCode is true
	if spec.Engine.TrustRemoteCode {
		warnings = append(warnings, "trustRemoteCode=true allows execution of arbitrary code from HuggingFace")
	}

	// Warn if contextLength is set for trtllm
	if spec.Engine.Type == airunwayv1alpha1.EngineTypeTRTLLM && spec.Engine.ContextLength != nil {
		warnings = append(warnings, "contextLength is ignored for TensorRT-LLM (must be configured at engine build time)")
	}

	// Warn if readOnly is true on a compilationCache volume
	if spec.Model.Storage != nil {
		for _, vol := range spec.Model.Storage.Volumes {
			if vol.Purpose == airunwayv1alpha1.VolumePurposeCompilationCache && vol.ReadOnly {
				warnings = append(warnings, fmt.Sprintf(
					"storage volume %q has purpose=compilationCache with readOnly=true; compilation cache requires write access",
					vol.Name,
				))
			}
		}
	}

	// Warn if readOnly is true on a modelCache volume with huggingface source (download will be skipped)
	if spec.Model.Source == airunwayv1alpha1.ModelSourceHuggingFace && spec.Model.Storage != nil {
		for _, vol := range spec.Model.Storage.Volumes {
			if vol.Purpose == airunwayv1alpha1.VolumePurposeModelCache && vol.ReadOnly {
				warnings = append(warnings, fmt.Sprintf(
					"storage volume %q has purpose=modelCache with readOnly=true; model download will be skipped (ensure the PVC already contains the model data)",
					vol.Name,
				))
			}
		}
	}

	return warnings
}
