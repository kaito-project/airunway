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
	"strings"
	"sync"
	"time"

	apiequality "k8s.io/apimachinery/pkg/api/equality"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	k8stypes "k8s.io/apimachinery/pkg/types"
	ctrl "sigs.k8s.io/controller-runtime"
	ctrlbuilder "sigs.k8s.io/controller-runtime/pkg/builder"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/event"
	"sigs.k8s.io/controller-runtime/pkg/handler"
	"sigs.k8s.io/controller-runtime/pkg/log"
	"sigs.k8s.io/controller-runtime/pkg/predicate"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
	inferencev1 "sigs.k8s.io/gateway-api-inference-extension/api/v1"

	airunwayv1alpha1 "github.com/kaito-project/airunway/controller/api/v1alpha1"
	"github.com/kaito-project/airunway/controller/internal/gateway"
	airmetrics "github.com/kaito-project/airunway/controller/internal/metrics"
)

// ModelDeploymentReconciler reconciles a ModelDeployment object
type ModelDeploymentReconciler struct {
	client.Client
	Scheme *runtime.Scheme

	// EnableProviderSelector controls whether the controller runs provider selection
	EnableProviderSelector bool

	// GatewayDetector checks for Gateway API CRD availability and resolves gateway config
	GatewayDetector *gateway.Detector

	// ProviderResolver looks up gateway capabilities from InferenceProviderConfig CRs.
	// When nil, the reconciler treats all providers as having no gateway capabilities.
	ProviderResolver gateway.ProviderCapabilityResolver

	// phaseCache tracks the last observed phase per ModelDeployment for detecting transitions.
	phaseCacheMu sync.RWMutex
	phaseCache   map[k8stypes.NamespacedName]phaseEntry
}

const (
	ExplicitProviderSelectionReason = "explicit provider selection"
)

// +kubebuilder:rbac:groups=airunway.ai,resources=modeldeployments,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=airunway.ai,resources=modeldeployments/status,verbs=get;update;patch
// +kubebuilder:rbac:groups=airunway.ai,resources=modeldeployments/finalizers,verbs=update
// +kubebuilder:rbac:groups=airunway.ai,resources=inferenceproviderconfigs,verbs=get;list;watch;update;patch
// +kubebuilder:rbac:groups=inference.networking.k8s.io,resources=inferencepools,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=gateway.networking.k8s.io,resources=httproutes,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=gateway.networking.k8s.io,resources=gateways,verbs=get;list;watch;update;patch
// +kubebuilder:rbac:groups=gateway.networking.k8s.io,resources=referencegrants,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups="",resources=services;serviceaccounts;configmaps,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups="",resources=pods,verbs=get;list;watch;patch
// +kubebuilder:rbac:groups=apps,resources=deployments,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=rbac.authorization.k8s.io,resources=roles;rolebindings,verbs=create;get;list;watch;update;patch;delete
// +kubebuilder:rbac:groups=coordination.k8s.io,resources=leases,verbs=create;get;update
// +kubebuilder:rbac:groups=inference.networking.x-k8s.io,resources=inferenceobjectives;inferencemodelrewrites,verbs=get;list;watch
// +kubebuilder:rbac:groups=networking.istio.io,resources=destinationrules,verbs=get;list;watch;create;update;patch;delete

// Reconcile handles the reconciliation loop for ModelDeployment resources.
//
// The core controller is intentionally minimal - it does NOT create provider resources.
// Instead, it:
// 1. Validates the ModelDeployment spec
// 2. Runs provider selection (if enabled and spec.provider.name is empty)
// 3. Updates status conditions
//
// Provider controllers (out-of-tree) watch for ModelDeployments where status.provider.name
// matches their name and handle the actual resource creation.
func (r *ModelDeploymentReconciler) Reconcile(ctx context.Context, req ctrl.Request) (result ctrl.Result, retErr error) {
	reconcileStart := time.Now()
	logger := log.FromContext(ctx)

	var md airunwayv1alpha1.ModelDeployment

	// Record reconciliation duration when a provider is known.
	defer func() {
		if md.Status.Provider != nil {
			airmetrics.ReconciliationDurationSeconds.WithLabelValues(md.Status.Provider.Name).Observe(time.Since(reconcileStart).Seconds())
		}
	}()

	// Fetch the ModelDeployment
	if err := r.Get(ctx, req.NamespacedName, &md); err != nil {
		if client.IgnoreNotFound(err) == nil {
			// MD was deleted — clean up phase cache, gauges, and gateway routes.
			r.cleanupMetrics(req.NamespacedName)
			r.cleanupGatewayAllowedRoutesForNamespace(ctx, req.Namespace)
		}
		return ctrl.Result{}, client.IgnoreNotFound(err)
	}

	// Capture previous phase entry for transition detection.
	r.phaseCacheMu.RLock()
	previousEntry := r.phaseCache[req.NamespacedName]
	r.phaseCacheMu.RUnlock()

	// Record metrics when reconciliation returns without error. This includes
	// successful status patches and early-return paths (deletion, pause) where
	// the in-memory state still reflects the API. On error, we skip metrics
	// because the retry will re-reconcile from the old state.
	defer func() {
		if retErr == nil {
			r.recordMetrics(&md, previousEntry)
		}
	}()

	// Save a deep copy as the patch base so we only send changed status fields.
	// This avoids clobbering status fields set by out-of-tree provider controllers.
	base := md.DeepCopy()

	logger.Info("Reconciling ModelDeployment", "name", md.Name, "namespace", md.Namespace)

	// If the ModelDeployment is being deleted, clean up gateway resources and return.
	// This catches foreground deletion or any other finalizer holding the MD open.
	if !md.DeletionTimestamp.IsZero() {
		if err := r.cleanupGatewayResources(ctx, &md); err != nil {
			logger.Error(err, "Failed to clean up gateway resources on deletion")
			r.recordReconcileError(&md, "gateway")
		}
		return ctrl.Result{}, nil
	}

	// Check for pause annotation
	if md.Annotations != nil && md.Annotations["airunway.ai/reconcile-paused"] == "true" {
		logger.Info("Reconciliation paused", "name", md.Name)
		return ctrl.Result{}, nil
	}

	// Update observed generation
	if md.Status.ObservedGeneration != md.Generation {
		md.Status.ObservedGeneration = md.Generation
	}

	// Initialize status if needed
	if md.Status.Phase == "" {
		md.Status.Phase = airunwayv1alpha1.DeploymentPhasePending
	}

	// Step 1: List all InferenceProviderConfigs once for use across validation and selection.
	// This is loaded regardless of EnableProviderSelector because validateSpec needs
	// provider capabilities to determine whether an engine supports CPU-only inference.
	var providerConfigs []airunwayv1alpha1.InferenceProviderConfig
	{
		var providerConfigList airunwayv1alpha1.InferenceProviderConfigList
		if err := r.List(ctx, &providerConfigList); err != nil {
			// If InferenceProviderConfig CRD is not installed, proceed with an empty list.
			// This allows the controller to run without any providers registered.
			if !isNoMatchError(err) {
				logger.Error(err, "Failed to list provider configs")
				return ctrl.Result{}, err
			}
		} else {
			providerConfigs = providerConfigList.Items
		}
	}

	// Step 2: Resolve the serving mode once for downstream use. Unlike engine,
	// serving mode is always derivable from spec (defaulting to Aggregated) so
	// it can be resolved before engine selection.
	resolvedServingMode := md.ResolvedServingMode()

	// Step 3: Select engine if needed (before validation, since validation needs engine type)
	if r.EnableProviderSelector {
		if err := r.selectEngine(ctx, &md, providerConfigs, resolvedServingMode); err != nil {
			logger.Error(err, "Engine selection failed", "name", md.Name)
			r.setCondition(&md, airunwayv1alpha1.ConditionTypeEngineSelected, metav1.ConditionFalse, "SelectionFailed", err.Error())
			md.Status.Message = fmt.Sprintf("Engine selection failed: %s", err.Error())
			r.recordReconcileError(&md, "engine_selection")
			return ctrl.Result{}, r.Status().Patch(ctx, &md, client.MergeFrom(base))
		}
	}

	// Step 4: Resolve the engine type once for downstream use (validation, CEL
	// evaluation, provider selection). We pass it through explicitly rather than
	// mutating md.Spec to avoid any risk of corrupting the shared informer
	// cache's backing data.
	resolvedEngineType := md.ResolvedEngineType()

	// Step 5: Validate the spec (uses resolved engine type and serving mode)
	if err := r.validateSpec(ctx, &md, providerConfigs, resolvedEngineType, resolvedServingMode); err != nil {
		logger.Error(err, "Validation failed", "name", md.Name)
		r.setCondition(&md, airunwayv1alpha1.ConditionTypeValidated, metav1.ConditionFalse, "ValidationFailed", err.Error())
		md.Status.Phase = airunwayv1alpha1.DeploymentPhaseFailed
		md.Status.Message = fmt.Sprintf("Validation failed: %s", err.Error())
		r.recordReconcileError(&md, "validation")
		return ctrl.Result{}, r.Status().Patch(ctx, &md, client.MergeFrom(base))
	}
	r.setCondition(&md, airunwayv1alpha1.ConditionTypeValidated, metav1.ConditionTrue, "ValidationPassed", "Schema validation passed")

	// Validation passed, so the engine recorded in status is provider-compatible.
	// Flip EngineSelected=True now (selectEngine deliberately defers this).
	if md.Status.Engine != nil && md.Status.Engine.Type != "" {
		if md.Spec.Engine.Type != "" {
			r.setCondition(&md, airunwayv1alpha1.ConditionTypeEngineSelected, metav1.ConditionTrue, "ExplicitSelection", "Engine explicitly specified in spec")
		} else {
			r.setCondition(&md, airunwayv1alpha1.ConditionTypeEngineSelected, metav1.ConditionTrue, "AutoSelected", fmt.Sprintf("Engine %s auto-selected from provider capabilities", md.Status.Engine.Type))
		}
	}

	// Step 6: Run provider selection if needed
	if r.EnableProviderSelector {
		if err := r.selectProvider(ctx, &md, providerConfigs, resolvedEngineType, resolvedServingMode); err != nil {
			logger.Error(err, "Provider selection failed", "name", md.Name)
			r.setCondition(&md, airunwayv1alpha1.ConditionTypeProviderSelected, metav1.ConditionFalse, "SelectionFailed", err.Error())
			md.Status.Message = fmt.Sprintf("Provider selection failed: %s", err.Error())
			r.recordReconcileError(&md, "provider_selection")
			return ctrl.Result{}, r.Status().Patch(ctx, &md, client.MergeFrom(base))
		}
	}

	// Step 7: Update status
	// If no provider is selected yet, stay in Pending
	if md.Status.Provider == nil || md.Status.Provider.Name == "" {
		if md.Spec.Provider != nil && md.Spec.Provider.Name != "" {
			// User explicitly specified a provider
			md.Status.Provider = &airunwayv1alpha1.ProviderStatus{
				Name:           md.Spec.Provider.Name,
				SelectedReason: ExplicitProviderSelectionReason,
			}
			r.setCondition(&md, airunwayv1alpha1.ConditionTypeProviderSelected, metav1.ConditionTrue, "ExplicitSelection", "Provider explicitly specified in spec")
		} else if !r.EnableProviderSelector {
			// No provider specified and selector disabled
			r.setCondition(&md, airunwayv1alpha1.ConditionTypeProviderSelected, metav1.ConditionFalse, "NoProvider", "No provider specified and provider-selector not enabled")
			md.Status.Message = "No provider specified and provider-selector not enabled"
		}
	}

	// The core controller does NOT create provider resources.
	// Provider controllers watch for ModelDeployments where status.provider.name matches
	// their name and handle the actual resource creation.
	//
	// The core controller's job is done after validation and provider selection.
	// Provider controllers will update:
	// - status.phase (Deploying, Running, Failed)
	// - status.provider.resourceName
	// - status.provider.resourceKind
	// - status.replicas
	// - status.endpoint
	// - ProviderCompatible, ResourceCreated, Ready conditions

	// Step 8: Reconcile gateway resources (InferencePool + HTTPRoute) when deployment is running
	if md.Status.Phase == airunwayv1alpha1.DeploymentPhaseRunning {
		if md.Spec.Gateway != nil && md.Spec.Gateway.Enabled != nil && !*md.Spec.Gateway.Enabled {
			// Gateway explicitly disabled — clean up any existing resources
			if err := r.cleanupGatewayResources(ctx, &md); err != nil {
				logger.Error(err, "Failed to clean up gateway resources")
				r.recordReconcileError(&md, "gateway")
			}
		} else {
			if err := r.reconcileGateway(ctx, &md); err != nil {
				logger.Error(err, "Gateway reconciliation failed", "name", md.Name)
				r.recordReconcileError(&md, "gateway")
				// If the error suggests CRDs were removed, refresh the detection cache
				if isNoMatchError(err) && r.GatewayDetector != nil {
					logger.Info("Gateway CRDs may have been removed, refreshing detection cache")
					r.GatewayDetector.Refresh()
				} else if apierrors.IsNotFound(err) {
					// Return an error to trigger exponential backoff retries.
					return ctrl.Result{}, err
				}
				// Non-fatal: don't block overall reconciliation
			}
		}
	}
	// Kubernetes garbage collection will handle cleanup when the ModelDeployment is deleted.

	logger.Info("Reconciliation complete", "name", md.Name, "phase", md.Status.Phase, "provider", md.Status.Provider)

	return ctrl.Result{}, r.Status().Patch(ctx, &md, client.MergeFrom(base))
}

// isNoMatchError checks if an error indicates that a CRD/resource type is not registered.
func isNoMatchError(err error) bool {
	if err == nil {
		return false
	}
	errStr := err.Error()
	return strings.Contains(errStr, "no matches for kind") ||
		strings.Contains(errStr, "the server could not find the requested resource") ||
		strings.Contains(errStr, "no kind is registered for the type")
}

// setCondition updates a condition on the ModelDeployment.
//
// LastTransitionTime is passed as metav1.Now() here, but
// meta.SetStatusCondition only adopts that timestamp when the condition's
// Status actually changes; on no-op updates (same Status) it preserves the
// previously stored LastTransitionTime. So this helper does not clobber the
// transition timestamp on repeated reconciles of an unchanged status.
func (r *ModelDeploymentReconciler) setCondition(md *airunwayv1alpha1.ModelDeployment, conditionType string, status metav1.ConditionStatus, reason, message string) {
	condition := metav1.Condition{
		Type:               conditionType,
		Status:             status,
		Reason:             reason,
		Message:            message,
		LastTransitionTime: metav1.Now(),
		ObservedGeneration: md.Generation,
	}
	meta.SetStatusCondition(&md.Status.Conditions, condition)
}

func providerConfigChangePredicate() predicate.Predicate {
	return predicate.Funcs{
		CreateFunc: func(event.CreateEvent) bool {
			return true
		},
		DeleteFunc: func(event.DeleteEvent) bool {
			return true
		},
		UpdateFunc: func(e event.UpdateEvent) bool {
			oldConfig, okOld := e.ObjectOld.(*airunwayv1alpha1.InferenceProviderConfig)
			newConfig, okNew := e.ObjectNew.(*airunwayv1alpha1.InferenceProviderConfig)
			if !okOld || !okNew {
				return false
			}
			return oldConfig.Status.Ready != newConfig.Status.Ready ||
				!apiequality.Semantic.DeepEqual(oldConfig.Spec, newConfig.Spec)
		},
		GenericFunc: func(event.GenericEvent) bool {
			return false
		},
	}
}

func modelDeploymentNeedsProviderSelection(md *airunwayv1alpha1.ModelDeployment) bool {
	if md.Spec.Provider != nil && md.Spec.Provider.Name != "" {
		return false
	}
	return md.Status.Provider == nil || md.Status.Provider.Name == ""
}

func providerConfigAffectsModelDeployment(md *airunwayv1alpha1.ModelDeployment, providerName string) bool {
	if md.Spec.Provider != nil && md.Spec.Provider.Name == providerName {
		return true
	}
	if md.Status.Provider != nil && md.Status.Provider.Name == providerName {
		return true
	}
	return modelDeploymentNeedsProviderSelection(md)
}

func (r *ModelDeploymentReconciler) mapProviderConfigToModelDeployments(ctx context.Context, obj client.Object) []reconcile.Request {
	providerConfig, ok := obj.(*airunwayv1alpha1.InferenceProviderConfig)
	if !ok {
		return nil
	}

	var mdList airunwayv1alpha1.ModelDeploymentList
	if err := r.List(ctx, &mdList); err != nil {
		log.FromContext(ctx).Error(err, "Failed to list ModelDeployments for provider config change", "provider", providerConfig.Name)
		return nil
	}

	requests := make([]reconcile.Request, 0, len(mdList.Items))
	seen := make(map[k8stypes.NamespacedName]struct{}, len(mdList.Items))
	for i := range mdList.Items {
		md := &mdList.Items[i]
		if !providerConfigAffectsModelDeployment(md, providerConfig.Name) {
			continue
		}

		key := k8stypes.NamespacedName{Name: md.Name, Namespace: md.Namespace}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		requests = append(requests, reconcile.Request{NamespacedName: key})
	}

	return requests
}

// SetupWithManager sets up the controller with the Manager.
func (r *ModelDeploymentReconciler) SetupWithManager(mgr ctrl.Manager) error {
	r.phaseCache = make(map[k8stypes.NamespacedName]phaseEntry)

	builder := ctrl.NewControllerManagedBy(mgr).
		For(&airunwayv1alpha1.ModelDeployment{}).
		Watches(
			&airunwayv1alpha1.InferenceProviderConfig{},
			handler.EnqueueRequestsFromMapFunc(r.mapProviderConfigToModelDeployments),
			ctrlbuilder.WithPredicates(providerConfigChangePredicate()),
		).
		Named("modeldeployment")

	// Watch InferencePool so the controller reconciles when one is created/deleted.
	// HTTPRoutes are not watched — they may be user-managed (BYO) and we don't
	// want deletion of an HTTPRoute to trigger a reconcile that recreates it.
	// Only add this watch if the gateway CRDs are actually installed.
	if r.GatewayDetector != nil && r.GatewayDetector.IsAvailable(context.Background()) {
		builder = builder.
			Owns(&inferencev1.InferencePool{})
	}

	return builder.Complete(r)
}
