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

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/controller-runtime/pkg/log"

	airunwayv1alpha1 "github.com/kaito-project/airunway/controller/api/v1alpha1"
	"github.com/kaito-project/airunway/controller/internal/gateway"
)

func (r *ModelDeploymentReconciler) providerInferencePoolExistsOrCreateDefault(ctx context.Context, md *airunwayv1alpha1.ModelDeployment, gatewayCapabilitities *airunwayv1alpha1.GatewayCapabilities, gwConfig *gateway.GatewayConfig) (bool, error) {
	logger := log.FromContext(ctx)

	if gatewayCapabilitities != nil && gatewayCapabilitities.ManagesInferencePool {
		// Provider manages the pool.
		return true, nil
	}

	// Traffic routed to the InferencePool will be forwarded to this port on selected pods (needs the pod/container port, not service port).
	port := int32(8000) // sensible default
	if md.Status.Endpoint != nil && md.Status.Endpoint.Service != "" {
		// Look up the service's target port (the actual container port)
		if targetPort := r.resolveTargetPort(ctx, md.Status.Endpoint.Service, md.Namespace); targetPort > 0 {
			port = targetPort
		} else if md.Status.Endpoint.Port > 0 {
			port = md.Status.Endpoint.Port
		}
	}

	// Ensure model pods have the selector label for InferencePool
	if err := r.labelModelPods(ctx, md); err != nil {
		logger.V(1).Info("Could not label model pods", "error", err)
		// Non-fatal: pods may not exist yet or provider may handle labels
	}

	// Create or update InferencePool
	if err := r.reconcileInferencePool(ctx, md, port, gwConfig.GetBBRNamespace()); err != nil {
		r.setCondition(md, airunwayv1alpha1.ConditionTypeGatewayReady, metav1.ConditionFalse, "InferencePoolFailed", err.Error())
		return false, fmt.Errorf("reconciling InferencePool: %w", err)
	}

	return false, nil
}
