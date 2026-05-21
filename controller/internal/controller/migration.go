/*
Copyright 2026.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

package controller

import (
	"context"
	"fmt"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/util/wait"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/log"
)

// MigrateLegacyProviderConfigs reads all InferenceProviderConfig resources using
// an unstructured client and rewrites any that still use the legacy flat engine
// format (engines: ["vllm"]) to the new per-engine capability format
// (engines: [{name: "vllm", gpuSupport: true, ...}]).
//
// This migration is idempotent: objects already in the new format are skipped.
// It must run before any typed Get/List calls to avoid deserialization failures
// during upgrades from the flat ProviderCapabilities schema.
func MigrateLegacyProviderConfigs(ctx context.Context, c client.Client) error {
	logger := log.FromContext(ctx).WithName("migration")

	gvk := schema.GroupVersionKind{
		Group:   "airunway.ai",
		Version: "v1alpha1",
		Kind:    "InferenceProviderConfig",
	}

	list := &unstructured.UnstructuredList{}
	list.SetGroupVersionKind(schema.GroupVersionKind{
		Group:   gvk.Group,
		Version: gvk.Version,
		Kind:    gvk.Kind + "List",
	})

	// Retry transient API server errors with a bounded exponential backoff so a
	// brief apiserver hiccup at pod start doesn't crashloop the controller.
	// Steps: ~1s, 2s, 4s, 8s, 16s (capped) ≈ 31s total.
	//
	// Terminal conditions short-circuit the loop:
	//   * NoMatch / NotFound — CRD not installed; benign skip.
	//   * Forbidden / Unauthorized — configuration error; fail fast.
	// Anything else is treated as transient.
	backoff := wait.Backoff{
		Duration: time.Second,
		Factor:   2.0,
		Jitter:   0.1,
		Steps:    5,
		Cap:      16 * time.Second,
	}
	var (
		crdAbsent bool
		lastErr   error
	)
	waitErr := wait.ExponentialBackoffWithContext(ctx, backoff, func(ctx context.Context) (bool, error) {
		err := c.List(ctx, list)
		switch {
		case err == nil:
			return true, nil
		case meta.IsNoMatchError(err) || apierrors.IsNotFound(err):
			crdAbsent = true
			return true, nil
		case apierrors.IsForbidden(err) || apierrors.IsUnauthorized(err):
			lastErr = err
			return false, err
		default:
			lastErr = err
			logger.Info("transient error listing InferenceProviderConfig; will retry", "error", err.Error())
			return false, nil
		}
	})
	if crdAbsent {
		logger.Info("InferenceProviderConfig CRD not present; skipping migration")
		return nil
	}
	if waitErr != nil {
		// Prefer the underlying API error over the generic timeout wrapper.
		if lastErr == nil {
			lastErr = waitErr
		}
		return fmt.Errorf("failed to list InferenceProviderConfig for migration after retries: %w", lastErr)
	}

	for _, item := range list.Items {
		name := item.GetName()

		capabilities, found, err := unstructured.NestedMap(item.Object, "spec", "capabilities")
		if err != nil || !found || capabilities == nil {
			continue
		}

		engines, found, err := unstructured.NestedSlice(capabilities, "engines")
		if err != nil || !found || len(engines) == 0 {
			continue
		}

		// Check if this is the legacy format (first element is a string, not an object)
		if _, isString := engines[0].(string); !isString {
			// Already in the new format (objects), skip
			continue
		}

		logger.Info("migrating legacy InferenceProviderConfig", "name", name)

		// Read the old flat fields
		oldServingModes, _, _ := unstructured.NestedStringSlice(capabilities, "servingModes")
		oldGPUSupport, _, _ := unstructured.NestedBool(capabilities, "gpuSupport")
		oldCPUSupport, _, _ := unstructured.NestedBool(capabilities, "cpuSupport")
		oldRequiresCRD, hasRequiresCRD, _ := unstructured.NestedBool(capabilities, "requiresCRD")
		oldGateway, hasGateway, _ := unstructured.NestedMap(capabilities, "gateway")

		// Convert each string engine to the new EngineCapability format
		newEngines := make([]interface{}, 0, len(engines))
		for _, e := range engines {
			engineName, ok := e.(string)
			if !ok {
				continue
			}

			engineCap := map[string]interface{}{
				"name":       engineName,
				"gpuSupport": oldGPUSupport,
				"cpuSupport": oldCPUSupport,
			}
			if len(oldServingModes) > 0 {
				modes := make([]interface{}, len(oldServingModes))
				for i, m := range oldServingModes {
					modes[i] = m
				}
				engineCap["servingModes"] = modes
			}
			if hasRequiresCRD {
				engineCap["requiresCRD"] = oldRequiresCRD
			}
			if hasGateway && len(oldGateway) > 0 {
				// Deep-copy so each engine gets its own map.
				engineCap["gateway"] = runtime.DeepCopyJSONValue(oldGateway)
			}
			newEngines = append(newEngines, engineCap)
		}

		// Replace engines with the new per-engine format and remove the legacy
		// flat keys. Mutate the existing capabilities map in place so that any
		// other top-level keys (present today or added in the future) are
		// preserved rather than silently dropped.
		capabilities["engines"] = newEngines
		delete(capabilities, "servingModes")
		delete(capabilities, "gpuSupport")
		delete(capabilities, "cpuSupport")
		delete(capabilities, "requiresCRD")
		delete(capabilities, "gateway")

		if err := unstructured.SetNestedField(item.Object, capabilities, "spec", "capabilities"); err != nil {
			return fmt.Errorf("failed to set migrated capabilities on %s: %w", name, err)
		}

		// Write back
		if err := c.Update(ctx, &item); err != nil {
			return fmt.Errorf("failed to update migrated InferenceProviderConfig %s: %w", name, err)
		}

		logger.Info("migrated InferenceProviderConfig to per-engine capabilities", "name", name)
	}

	return nil
}
