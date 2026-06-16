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

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/log"

	airunwayv1alpha1 "github.com/kaito-project/airunway/controller/api/v1alpha1"
	inferencev1 "sigs.k8s.io/gateway-api-inference-extension/api/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

func (r *ModelDeploymentReconciler) cleanupGatewayResources(ctx context.Context, md *airunwayv1alpha1.ModelDeployment) error {
	logger := log.FromContext(ctx)

	// Resolve provider gateway capabilities. A nil result with nil error means
	// the provider simply does not declare gateway capabilities — that is the
	// common case and must NOT log an error every reconcile.
	var gatewayCapabilities *airunwayv1alpha1.GatewayCapabilities
	var err error
	if gatewayCapabilities, err = r.resolveProviderGatewayCapabilities(ctx, md); err != nil {
		logger.V(1).Info("Could not resolve provider gateway capabilities, proceeding without provider-specific gateway capabilities", "error", err)
	}
	providerManagedPool := gatewayCapabilities != nil && gatewayCapabilities.ManagesInferencePool

	eppName := md.Name + "-epp"

	if !providerManagedPool {
		// Delete InferencePool if it exists
		pool := &inferencev1.InferencePool{
			ObjectMeta: metav1.ObjectMeta{
				Name:      md.Name,
				Namespace: md.Namespace,
			},
		}
		if err := r.Delete(ctx, pool); client.IgnoreNotFound(err) != nil {
			return fmt.Errorf("failed to delete InferencePool: %w", err)
		}
	} else {
		logger.V(1).Info("Skipping InferencePool cleanup because provider manages the pool")
	}

	// Delete auto-created HTTPRoute (skip if user-provided)
	if md.Spec.Gateway == nil || md.Spec.Gateway.HTTPRouteRef == "" {
		route := &gatewayv1.HTTPRoute{
			ObjectMeta: metav1.ObjectMeta{
				Name:      md.Name,
				Namespace: md.Namespace,
			},
		}
		if err := r.Delete(ctx, route); client.IgnoreNotFound(err) != nil {
			return fmt.Errorf("failed to delete HTTPRoute: %w", err)
		}
	}

	if !providerManagedPool {
		// Delete EPP resources
		eppResources := []client.Object{
			&appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{Name: eppName, Namespace: md.Namespace}},
			&corev1.Service{ObjectMeta: metav1.ObjectMeta{Name: eppName, Namespace: md.Namespace}},
			&corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{Name: eppName, Namespace: md.Namespace}},
			&rbacv1.RoleBinding{ObjectMeta: metav1.ObjectMeta{Name: eppName, Namespace: md.Namespace}},
			&rbacv1.Role{ObjectMeta: metav1.ObjectMeta{Name: eppName, Namespace: md.Namespace}},
			&corev1.ServiceAccount{ObjectMeta: metav1.ObjectMeta{Name: eppName, Namespace: md.Namespace}},
		}

		// Conditionally delete the DestinationRule if Istio is present
		if _, err := r.Client.RESTMapper().RESTMapping(schema.GroupKind{Group: "networking.istio.io", Kind: "DestinationRule"}); err == nil {
			dr := &unstructured.Unstructured{}
			dr.SetGroupVersionKind(schema.GroupVersionKind{Group: "networking.istio.io", Version: "v1beta1", Kind: "DestinationRule"})
			dr.SetName(eppName)
			dr.SetNamespace(md.Namespace)
			eppResources = append(eppResources, dr)
		}

		for _, obj := range eppResources {
			if err := r.Delete(ctx, obj); client.IgnoreNotFound(err) != nil {
				logger.V(1).Info("Could not delete EPP resource", "resource", obj.GetObjectKind(), "error", err)
			}
		}
	} else {
		logger.V(1).Info("Skipping deletion of EPP resources because provider manages EPP")
	}

	// Revert Gateway allowedRoutes if no other ModelDeployments in this namespace need gateway access.
	if r.GatewayDetector != nil && r.GatewayDetector.PatchGateway {
		if err := r.cleanupGatewayAllowedRoutes(ctx, md); err != nil {
			logger.V(1).Info("Could not revert Gateway allowedRoutes", "error", err)
		}
	}

	md.Status.Gateway = nil
	r.setCondition(md, airunwayv1alpha1.ConditionTypeGatewayReady, metav1.ConditionFalse, "GatewayDisabled", "Gateway resources cleaned up")

	// Clear the httproute-created annotation so the controller will recreate the
	// HTTPRoute when the deployment recovers to Running. Without this, a transient
	// phase change (e.g. crash-loop) would permanently suppress HTTPRoute recreation.
	if md.Annotations[airunwayv1alpha1.HTTPRouteCreated] == "true" {
		base := md.DeepCopy()
		delete(md.Annotations, airunwayv1alpha1.HTTPRouteCreated)
		if err := r.Patch(ctx, md, client.MergeFrom(base)); err != nil {
			logger.V(1).Info("Could not clear httproute-created annotation during cleanup", "error", err)
		}
	}

	logger.Info("Gateway resources cleaned up", "name", md.Name)
	return nil
}

func (r *ModelDeploymentReconciler) cleanupGatewayAllowedRoutes(ctx context.Context, md *airunwayv1alpha1.ModelDeployment) error {
	logger := log.FromContext(ctx)

	// Resolve gateway config; if we can't find the gateway, nothing to revert.
	gwConfig, err := r.resolveGatewayConfig(ctx)
	if err != nil {
		return nil
	}

	// Only relevant for cross-namespace routing.
	if md.Namespace == gwConfig.GatewayNamespace {
		return nil
	}

	// Check if any other ModelDeployments in the same namespace still need gateway access.
	var mdList airunwayv1alpha1.ModelDeploymentList
	if err := r.List(ctx, &mdList, client.InNamespace(md.Namespace)); err != nil {
		return fmt.Errorf("listing ModelDeployments: %w", err)
	}
	for i := range mdList.Items {
		other := &mdList.Items[i]
		if other.UID == md.UID {
			continue
		}
		// If another MD exists that hasn't opted out of gateway, keep the route.
		if other.Spec.Gateway == nil || other.Spec.Gateway.Enabled == nil || *other.Spec.Gateway.Enabled {
			return nil
		}
	}

	// No other MDs need gateway in this namespace — remove it from the In-list.
	var gw gatewayv1.Gateway
	if err := r.Get(ctx, client.ObjectKey{Name: gwConfig.GatewayName, Namespace: gwConfig.GatewayNamespace}, &gw); err != nil {
		return fmt.Errorf("getting Gateway: %w", err)
	}

	existing := allowedNamespacesFromGateway(&gw)
	if !existing[md.Namespace] {
		return nil // not in the list, nothing to do
	}
	delete(existing, md.Namespace)

	if len(existing) == 0 {
		// No cross-namespace routes remain — revert to SameNamespace.
		fromSame := gatewayv1.NamespacesFromSame
		base := gw.DeepCopy()
		for i := range gw.Spec.Listeners {
			if gw.Spec.Listeners[i].AllowedRoutes != nil {
				gw.Spec.Listeners[i].AllowedRoutes.Namespaces = &gatewayv1.RouteNamespaces{
					From: &fromSame,
				}
			}
		}
		if err := r.Patch(ctx, &gw, client.MergeFrom(base)); err != nil {
			return fmt.Errorf("reverting Gateway listeners: %w", err)
		}
	} else {
		// Other namespaces still need access — update the In-list without this namespace.
		if err := r.patchGatewayListenerSelector(ctx, gwConfig, existing); err != nil {
			return fmt.Errorf("updating Gateway listeners: %w", err)
		}
	}

	logger.Info("Removed namespace from Gateway allowedRoutes", "gateway", gwConfig.GatewayName, "namespace", md.Namespace)
	return nil
}

// cleanupGatewayAllowedRoutesForNamespace removes a namespace from the Gateway's
// allowedRoutes when a ModelDeployment has already been deleted (no MD object available).
// It checks whether any remaining MDs in the namespace still need gateway access.
func (r *ModelDeploymentReconciler) cleanupGatewayAllowedRoutesForNamespace(ctx context.Context, namespace string) {
	logger := log.FromContext(ctx)

	if r.GatewayDetector == nil || !r.GatewayDetector.PatchGateway {
		return
	}
	if !r.GatewayDetector.IsAvailable(ctx) {
		return
	}

	gwConfig, err := r.resolveGatewayConfig(ctx)
	if err != nil {
		return
	}
	if namespace == gwConfig.GatewayNamespace {
		return
	}

	// Check if any remaining MDs in the namespace still need gateway access.
	var mdList airunwayv1alpha1.ModelDeploymentList
	if err := r.List(ctx, &mdList, client.InNamespace(namespace)); err != nil {
		logger.V(1).Info("Could not list ModelDeployments for gateway cleanup", "namespace", namespace, "error", err)
		return
	}
	for i := range mdList.Items {
		other := &mdList.Items[i]
		if other.Spec.Gateway == nil || other.Spec.Gateway.Enabled == nil || *other.Spec.Gateway.Enabled {
			return // another MD still needs gateway
		}
	}

	// No MDs need gateway in this namespace — remove it from the In-list.
	var gw gatewayv1.Gateway
	if err := r.Get(ctx, client.ObjectKey{Name: gwConfig.GatewayName, Namespace: gwConfig.GatewayNamespace}, &gw); err != nil {
		logger.V(1).Info("Could not get Gateway for cleanup", "error", err)
		return
	}

	existing := allowedNamespacesFromGateway(&gw)
	if !existing[namespace] {
		return
	}
	delete(existing, namespace)

	if len(existing) == 0 {
		fromSame := gatewayv1.NamespacesFromSame
		base := gw.DeepCopy()
		for i := range gw.Spec.Listeners {
			if gw.Spec.Listeners[i].AllowedRoutes != nil {
				gw.Spec.Listeners[i].AllowedRoutes.Namespaces = &gatewayv1.RouteNamespaces{
					From: &fromSame,
				}
			}
		}
		if err := r.Patch(ctx, &gw, client.MergeFrom(base)); err != nil {
			logger.V(1).Info("Could not revert Gateway listeners", "error", err)
			return
		}
	} else {
		if err := r.patchGatewayListenerSelector(ctx, gwConfig, existing); err != nil {
			logger.V(1).Info("Could not update Gateway listeners", "error", err)
			return
		}
	}

	logger.Info("Removed namespace from Gateway allowedRoutes after MD deletion", "gateway", gwConfig.GatewayName, "namespace", namespace)
}

// restartBBRIfPresent triggers a rolling restart of the body-based-router Deployment (if present
// in the given namespace) by updating its restart annotation. This is necessary because BBR builds
// its internal model registry on startup and does not dynamically watch InferencePools.
//
// The namespace is resolved by GatewayConfig.GetBBRNamespace(), which reads the
// airunway.ai/bbr-namespace annotation from the Gateway resource, falling back to the
// Gateway's own namespace.
func (r *ModelDeploymentReconciler) restartBBRIfPresent(ctx context.Context, namespace string) error {
	var bbr appsv1.Deployment
	if err := r.Get(ctx, client.ObjectKey{Name: "body-based-router", Namespace: namespace}, &bbr); err != nil {
		return client.IgnoreNotFound(err)
	}
	patch := []byte(`{"spec":{"template":{"metadata":{"annotations":{"airunway.ai/restartedAt":"` + time.Now().UTC().Format(time.RFC3339) + `"}}}}}`)
	if err := r.Patch(ctx, &bbr, client.RawPatch(types.StrategicMergePatchType, patch)); err != nil {
		return fmt.Errorf("patching body-based-router: %w", err)
	}
	log.FromContext(ctx).Info("Triggered BBR rolling restart to discover new InferencePool", "namespace", namespace)
	return nil
}
