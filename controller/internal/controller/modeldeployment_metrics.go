/*
Copyright 2026.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
*/

package controller

import (
	"time"

	k8stypes "k8s.io/apimachinery/pkg/types"

	airunwayv1alpha1 "github.com/kaito-project/airunway/controller/api/v1alpha1"
	airmetrics "github.com/kaito-project/airunway/controller/internal/metrics"
)

// phaseEntry holds per-deployment metrics state that the K8s API cannot
// provide: previous phase, wall-clock timestamps, one-shot guards, and
// aggregate gauge data. Volatile on restart; transitions are skipped
// until each deployment reconciles again.
type phaseEntry struct {
	// Phase is the last observed deployment phase.
	Phase airunwayv1alpha1.DeploymentPhase
	// Provider is the provider name for this deployment, used to aggregate metrics.
	Provider string
	// Replicas holds the last observed replica counts (desired, ready, available).
	Replicas [3]int32
	// DeployingTimestamp records when the Deploying phase was first observed.
	// Used to compute provision duration (Deploying→Running wall-clock time).
	DeployingTimestamp time.Time
	// RunningMetricsRecorded tracks whether one-time Running metrics (lead time,
	// provision duration) have already been recorded for this deployment lifecycle.
	RunningMetricsRecorded bool
	// MetricsInitialized tracks whether DORA metric label combinations have been
	// pre-initialized for this deployment's provider. This ensures Prometheus sees
	// zero-valued counters/histograms before any real observations, so that
	// increase() correctly reports the first event.
	MetricsInitialized bool
}

// recordMetrics updates all Prometheus metrics for the current ModelDeployment state.
func (r *ModelDeploymentReconciler) recordMetrics(md *airunwayv1alpha1.ModelDeployment, previous phaseEntry) {
	// Lazy-init the phase cache so recordMetrics is safe even if SetupWithManager was not called
	// (e.g. in unit tests that invoke Reconcile directly).
	r.phaseCacheMu.Lock()
	if r.phaseCache == nil {
		r.phaseCache = make(map[k8stypes.NamespacedName]phaseEntry)
	}
	r.phaseCacheMu.Unlock()

	providerName := ""
	if md.Status.Provider != nil {
		providerName = md.Status.Provider.Name
	}
	currentPhase := md.Status.Phase
	key := k8stypes.NamespacedName{Name: md.Name, Namespace: md.Namespace}

	// Known phases used to zero-initialize all label combinations for this provider.
	phases := []string{"Pending", "Deploying", "Running", "Failed", "Terminating"}

	// Build the updated phase entry. Start from the previous entry to preserve timestamps.
	entry := previous

	// Update replica counts and provider in the entry for aggregate computation
	if md.Status.Replicas != nil {
		entry.Replicas = [3]int32{md.Status.Replicas.Desired, md.Status.Replicas.Ready, md.Status.Replicas.Available}
	} else {
		entry.Replicas = [3]int32{}
	}
	entry.Provider = providerName

	// Zero-initialize all known label combinations so that increase() and
	// rate() work correctly from the first scrape.
	if providerName != "" && !previous.MetricsInitialized {
		airmetrics.ReadyDurationSeconds.WithLabelValues(providerName)
		airmetrics.ProvisionDurationSeconds.WithLabelValues(providerName)
		airmetrics.ReconciliationDurationSeconds.WithLabelValues(providerName)
		for _, errType := range []string{"validation", "engine_selection", "provider_selection", "gateway"} {
			airmetrics.ReconciliationErrorsTotal.WithLabelValues(providerName, errType)
		}
		for _, reason := range []string{"manual", "auto"} {
			airmetrics.ProviderSelection.WithLabelValues(providerName, reason)
		}
		for _, from := range phases {
			for _, to := range phases {
				if from != to {
					airmetrics.PhaseTransitionsTotal.WithLabelValues(providerName, from, to)
				}
			}
		}
		entry.MetricsInitialized = true
	}

	// Record provider selection counter.
	// When the previous provider is empty and a new provider is assigned, it indicates a selection event occured,
	// either auto or manual. We use the presence of the ExplicitProviderSelectionReason reason to distinguish between them.
	if previous.Provider == "" && providerName != "" {
		reason := "auto"
		if md.Status.Provider != nil && md.Status.Provider.SelectedReason == ExplicitProviderSelectionReason {
			reason = "manual"
		}
		airmetrics.ProviderSelection.WithLabelValues(providerName, reason).Inc()
	}

	// Record phase transition counter.
	// When previous.Phase is empty (first reconciliation or after controller restart),
	// we skip recording a transition to avoid a spurious "" -> X event.
	if previous.Phase != "" && currentPhase != previous.Phase {
		// Skip recording transitions that involve deployments without providers.
		if providerName != "" {
			airmetrics.PhaseTransitionsTotal.WithLabelValues(
				providerName, string(previous.Phase), string(currentPhase),
			).Inc()
		}
	}

	// Track when the Deploying phase starts. This gives us a reliable wall-clock
	// anchor for provision duration, immune to condition-timestamp flapping
	// (e.g. ResourceCreated being toggled by conflict retries).
	if currentPhase == airunwayv1alpha1.DeploymentPhaseDeploying && previous.Phase != airunwayv1alpha1.DeploymentPhaseDeploying {
		entry.DeployingTimestamp = time.Now()
	}

	// Record one-time Running metrics only when we observe an actual phase
	// transition into Running. This avoids duplicate/inflated lead-time samples
	// after controller restarts, where the in-memory cache is empty and the
	// previous phase is unknown.
	transitionedToRunning := currentPhase == airunwayv1alpha1.DeploymentPhaseRunning &&
		previous.Phase != "" &&
		previous.Phase != airunwayv1alpha1.DeploymentPhaseRunning
	if transitionedToRunning && !previous.RunningMetricsRecorded {
		// Skip recording if provider is not known.
		if providerName != "" {
			// Lead time: wall-clock time from CR creation to first observed transition
			// into Running.
			leadTime := time.Since(md.CreationTimestamp.Time).Seconds()
			airmetrics.ReadyDurationSeconds.WithLabelValues(providerName).Observe(leadTime)

			// Provision duration: wall-clock time from Deploying to Running.
			// Only recorded when we observed the Deploying phase start (i.e. the
			// controller was running when the deployment first entered Deploying).
			if !entry.DeployingTimestamp.IsZero() {
				provisionDuration := time.Since(entry.DeployingTimestamp).Seconds()
				airmetrics.ProvisionDurationSeconds.WithLabelValues(providerName).Observe(provisionDuration)
			}

			entry.RunningMetricsRecorded = true
		}
	}

	// Reset RunningMetricsRecorded when leaving Running (allows re-recording if
	// deployment cycles back through Deploying→Running, e.g. after a rollback).
	if currentPhase != airunwayv1alpha1.DeploymentPhaseRunning {
		entry.RunningMetricsRecorded = false
	}

	// Update the phase cache and apply gauge deltas (decrement old, increment new).
	entry.Phase = currentPhase
	r.phaseCacheMu.Lock()
	decrementPhaseEntryGauges(previous)
	incrementPhaseEntryGauges(entry)
	r.phaseCache[key] = entry
	r.phaseCacheMu.Unlock()
}

// decrementPhaseEntryGauges subtracts a phaseEntry's contributions from the aggregate gauges.
func decrementPhaseEntryGauges(e phaseEntry) {
	replicaStates := []string{"desired", "ready", "available"}
	if e.Phase != "" {
		airmetrics.DeploymentStatus.WithLabelValues(e.Provider, string(e.Phase)).Dec()
	}
	for i, s := range replicaStates {
		airmetrics.DeploymentReplicas.WithLabelValues(e.Provider, s).Sub(float64(e.Replicas[i]))
	}
}

// incrementPhaseEntryGauges adds a phaseEntry's contributions to the aggregate gauges.
func incrementPhaseEntryGauges(e phaseEntry) {
	replicaStates := []string{"desired", "ready", "available"}
	if e.Phase != "" {
		airmetrics.DeploymentStatus.WithLabelValues(e.Provider, string(e.Phase)).Inc()
	}
	for i, s := range replicaStates {
		airmetrics.DeploymentReplicas.WithLabelValues(e.Provider, s).Add(float64(e.Replicas[i]))
	}
}

// cleanupMetrics decrements aggregate gauges and removes the phase cache entry for a deleted ModelDeployment.
func (r *ModelDeploymentReconciler) cleanupMetrics(key k8stypes.NamespacedName) {
	r.phaseCacheMu.Lock()
	if old, ok := r.phaseCache[key]; ok {
		decrementPhaseEntryGauges(old)
		delete(r.phaseCache, key)
	}
	r.phaseCacheMu.Unlock()
}

// recordReconcileError records a reconciliation error metric.
// Skipped when no provider is assigned to avoid empty-label series.
func (r *ModelDeploymentReconciler) recordReconcileError(md *airunwayv1alpha1.ModelDeployment, errorType string) {
	if md.Status.Provider == nil {
		return
	}
	airmetrics.ReconciliationErrorsTotal.WithLabelValues(md.Status.Provider.Name, errorType).Inc()
}
