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

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/log"

	airunwayv1alpha1 "github.com/kaito-project/airunway/controller/api/v1alpha1"
	"github.com/kaito-project/airunway/controller/internal/gateway"
)

// reconcileEPP creates or updates the Endpoint Picker Proxy deployment and service
// for a ModelDeployment's InferencePool.
func (r *ModelDeploymentReconciler) reconcileEPP(ctx context.Context, md *airunwayv1alpha1.ModelDeployment) error {
	eppName := md.Name + "-epp"
	eppPort := r.GatewayDetector.EPPServicePort
	if eppPort == 0 {
		eppPort = 9002
	}
	eppImage := r.GatewayDetector.EPPImage
	if eppImage == "" {
		eppImage = "registry.k8s.io/gateway-api-inference-extension/epp:" + gateway.DefaultGAIEVersion
	}

	labels := map[string]string{
		"app.kubernetes.io/name":       eppName,
		"app.kubernetes.io/instance":   md.Name,
		"app.kubernetes.io/managed-by": "airunway",
	}

	// ServiceAccount
	sa := &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{
			Name:      eppName,
			Namespace: md.Namespace,
		},
	}
	if _, err := ctrl.CreateOrUpdate(ctx, r.Client, sa, func() error {
		return ctrl.SetControllerReference(md, sa, r.Scheme)
	}); err != nil {
		return fmt.Errorf("failed to create/update EPP ServiceAccount: %w", err)
	}

	// Role for EPP (needs to watch pods and inferencepools)
	role := &rbacv1.Role{
		ObjectMeta: metav1.ObjectMeta{
			Name:      eppName,
			Namespace: md.Namespace,
		},
	}
	if _, err := ctrl.CreateOrUpdate(ctx, r.Client, role, func() error {
		role.Rules = []rbacv1.PolicyRule{
			{
				APIGroups: []string{""},
				Resources: []string{"pods"},
				Verbs:     []string{"get", "watch", "list"},
			},
			{
				APIGroups: []string{"inference.networking.k8s.io"},
				Resources: []string{"inferencepools"},
				Verbs:     []string{"get", "watch", "list"},
			},
			{
				APIGroups: []string{"coordination.k8s.io"},
				Resources: []string{"leases"},
				Verbs:     []string{"create", "get", "update"},
			},
			{
				APIGroups: []string{"inference.networking.x-k8s.io"},
				Resources: []string{"inferenceobjectives", "inferencemodelrewrites"},
				Verbs:     []string{"get", "watch", "list"},
			},
		}
		return ctrl.SetControllerReference(md, role, r.Scheme)
	}); err != nil {
		return fmt.Errorf("failed to create/update EPP Role: %w", err)
	}

	// RoleBinding
	rb := &rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name:      eppName,
			Namespace: md.Namespace,
		},
	}
	if _, err := ctrl.CreateOrUpdate(ctx, r.Client, rb, func() error {
		rb.RoleRef = rbacv1.RoleRef{
			APIGroup: "rbac.authorization.k8s.io",
			Kind:     "Role",
			Name:     eppName,
		}
		rb.Subjects = []rbacv1.Subject{
			{
				Kind:      "ServiceAccount",
				Name:      eppName,
				Namespace: md.Namespace,
			},
		}
		return ctrl.SetControllerReference(md, rb, r.Scheme)
	}); err != nil {
		return fmt.Errorf("failed to create/update EPP RoleBinding: %w", err)
	}

	// ConfigMap for EPP plugins config
	cm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      eppName,
			Namespace: md.Namespace,
		},
	}
	if _, err := ctrl.CreateOrUpdate(ctx, r.Client, cm, func() error {
		cm.Data = map[string]string{
			"default-plugins.yaml": `apiVersion: inference.networking.x-k8s.io/v1alpha1
kind: EndpointPickerConfig
`,
		}
		return ctrl.SetControllerReference(md, cm, r.Scheme)
	}); err != nil {
		return fmt.Errorf("failed to create/update EPP ConfigMap: %w", err)
	}

	// Deployment
	replicas := int32(1)
	dep := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      eppName,
			Namespace: md.Namespace,
		},
	}
	if _, err := ctrl.CreateOrUpdate(ctx, r.Client, dep, func() error {
		dep.Spec = appsv1.DeploymentSpec{
			Replicas: &replicas,
			Strategy: appsv1.DeploymentStrategy{Type: appsv1.RecreateDeploymentStrategyType},
			Selector: &metav1.LabelSelector{MatchLabels: labels},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: labels},
				Spec: corev1.PodSpec{
					ServiceAccountName:            eppName,
					TerminationGracePeriodSeconds: int64Ptr(130),
					Containers: []corev1.Container{
						{
							Name:            "epp",
							Image:           eppImage,
							ImagePullPolicy: corev1.PullIfNotPresent,
							Args: []string{
								"--pool-name", md.Name,
								"--pool-namespace", md.Namespace,
								"--zap-encoder", "json",
								"--config-file", "/config/default-plugins.yaml",
								"--tracing=false",
							},
							Ports: []corev1.ContainerPort{
								{Name: "grpc", ContainerPort: eppPort},
								{Name: "grpc-health", ContainerPort: 9003},
							},
							Env: []corev1.EnvVar{
								{Name: "NAMESPACE", ValueFrom: &corev1.EnvVarSource{
									FieldRef: &corev1.ObjectFieldSelector{FieldPath: "metadata.namespace"},
								}},
								{Name: "POD_NAME", ValueFrom: &corev1.EnvVarSource{
									FieldRef: &corev1.ObjectFieldSelector{FieldPath: "metadata.name"},
								}},
							},
							LivenessProbe: &corev1.Probe{
								ProbeHandler:        corev1.ProbeHandler{GRPC: &corev1.GRPCAction{Port: 9003, Service: strPtr("inference-extension")}},
								InitialDelaySeconds: 30,
								PeriodSeconds:       10,
								FailureThreshold:    5,
							},
							ReadinessProbe: &corev1.Probe{
								ProbeHandler:        corev1.ProbeHandler{GRPC: &corev1.GRPCAction{Port: 9003, Service: strPtr("inference-extension")}},
								InitialDelaySeconds: 10,
								PeriodSeconds:       5,
							},
							VolumeMounts: []corev1.VolumeMount{
								{Name: "plugins-config", MountPath: "/config"},
							},
						},
					},
					Volumes: []corev1.Volume{
						{
							Name: "plugins-config",
							VolumeSource: corev1.VolumeSource{
								ConfigMap: &corev1.ConfigMapVolumeSource{
									LocalObjectReference: corev1.LocalObjectReference{Name: eppName},
								},
							},
						},
					},
				},
			},
		}
		return ctrl.SetControllerReference(md, dep, r.Scheme)
	}); err != nil {
		return fmt.Errorf("failed to create/update EPP Deployment: %w", err)
	}

	// Service
	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      eppName,
			Namespace: md.Namespace,
		},
	}
	if _, err := ctrl.CreateOrUpdate(ctx, r.Client, svc, func() error {
		h2c := "kubernetes.io/h2c"
		svc.Spec = corev1.ServiceSpec{
			Selector: labels,
			Ports: []corev1.ServicePort{
				{Name: "grpc-ext-proc", Protocol: corev1.ProtocolTCP, Port: eppPort, AppProtocol: &h2c},
			},
			Type: corev1.ServiceTypeClusterIP,
		}
		return ctrl.SetControllerReference(md, svc, r.Scheme)
	}); err != nil {
		return fmt.Errorf("failed to create/update EPP Service: %w", err)
	}

	if err := r.reconcileEPPDestinationRule(ctx, md, eppName, md.Namespace); err != nil {
		return fmt.Errorf("failed to create/update EPP DestinationRule: %w", err)
	}

	log.FromContext(ctx).V(1).Info("EPP reconciled", "name", eppName, "image", eppImage)
	return nil
}

// reconcileEPPDestinationRule creates or updates the Istio DestinationRule for the EPP service,
// but only if Istio is detected (i.e. the DestinationRule CRD is registered in the cluster).
// EPP serves TLS by default (--secure-serving=true) with a self-signed certificate.
// kGateway handles this natively, but Istio's sidecar needs a DestinationRule with
// mode: SIMPLE + insecureSkipVerify to connect to the EPP's TLS endpoint.
func (r *ModelDeploymentReconciler) reconcileEPPDestinationRule(ctx context.Context, md *airunwayv1alpha1.ModelDeployment, eppName, eppNamespace string) error {
	gk := schema.GroupKind{Group: "networking.istio.io", Kind: "DestinationRule"}
	if _, err := r.Client.RESTMapper().RESTMapping(gk); err != nil {
		log.FromContext(ctx).V(1).Info("Istio not detected, skipping DestinationRule", "eppName", eppName)
		return nil
	}

	dr := &unstructured.Unstructured{}
	dr.SetGroupVersionKind(schema.GroupVersionKind{
		Group:   "networking.istio.io",
		Version: "v1beta1",
		Kind:    "DestinationRule",
	})
	dr.SetName(eppName)
	dr.SetNamespace(eppNamespace)

	_, err := ctrl.CreateOrUpdate(ctx, r.Client, dr, func() error {
		if err := unstructured.SetNestedField(dr.Object, map[string]interface{}{
			"host": fmt.Sprintf("%s.%s.svc.cluster.local", eppName, eppNamespace),
			"trafficPolicy": map[string]interface{}{
				"tls": map[string]interface{}{
					"mode":               "SIMPLE",
					"insecureSkipVerify": true,
				},
			},
		}, "spec"); err != nil {
			return err
		}
		return ctrl.SetControllerReference(md, dr, r.Scheme)
	})
	return err
}

func int64Ptr(i int64) *int64 { return &i }
func strPtr(s string) *string { return &s }
