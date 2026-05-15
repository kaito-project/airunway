package kaito

import (
	"context"
	"encoding/json"
	"testing"

	airunwayv1alpha1 "github.com/kaito-project/airunway/controller/api/v1alpha1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

func TestGetProviderConfigSpec(t *testing.T) {
	spec := GetProviderConfigSpec()

	if len(spec.SelectionRules) != 2 {
		t.Fatalf("expected 2 selection rules, got %d", len(spec.SelectionRules))
	}
	if spec.SelectionRules[0].Priority != 100 {
		t.Errorf("expected first rule priority 100, got %d", spec.SelectionRules[0].Priority)
	}
}

func TestGetInstallationInfo(t *testing.T) {
	info := GetInstallationInfo()
	if info == nil {
		t.Fatal("expected non-nil installation info")
	}
	if info.Description == "" {
		t.Error("expected non-empty description")
	}
	if info.DefaultNamespace != "kaito-workspace" {
		t.Errorf("expected defaultNamespace 'kaito-workspace', got %s", info.DefaultNamespace)
	}
	if len(info.HelmRepos) != 1 {
		t.Fatalf("expected 1 helm repo, got %d", len(info.HelmRepos))
	}
	if len(info.HelmCharts) != 1 {
		t.Fatalf("expected 1 helm chart, got %d", len(info.HelmCharts))
	}
	if len(info.Steps) != 3 {
		t.Fatalf("expected 3 installation steps, got %d", len(info.Steps))
	}
}

func TestNewProviderConfigManager(t *testing.T) {
	mgr := NewProviderConfigManager(nil)
	if mgr == nil {
		t.Fatal("expected non-nil manager")
	}
}

func TestProviderConstants(t *testing.T) {
	if ProviderConfigName != "kaito" {
		t.Errorf("expected provider config name 'kaito', got %s", ProviderConfigName)
	}
	if ProviderVersion != "kaito-provider:v0.1.0" {
		t.Errorf("expected provider version 'kaito-provider:v0.1.0', got %s", ProviderVersion)
	}
}

func TestBuildAnnotations(t *testing.T) {
	annotations, err := buildAnnotations()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	requiredKeys := []string{
		airunwayv1alpha1.AnnotationDisplayName,
		airunwayv1alpha1.AnnotationDescription,
		airunwayv1alpha1.AnnotationDefaultNamespace,
		airunwayv1alpha1.AnnotationDocumentationURL,
		airunwayv1alpha1.AnnotationCapabilities,
		airunwayv1alpha1.AnnotationHealth,
		airunwayv1alpha1.AnnotationInstallation,
		airunwayv1alpha1.AnnotationDocumentation,
	}
	for _, key := range requiredKeys {
		if annotations[key] == "" {
			t.Fatalf("expected annotation %s to be set", key)
		}
	}
	if annotations[airunwayv1alpha1.AnnotationDocumentationURL] != ProviderDocumentation {
		t.Fatalf("expected documentation-url annotation %q, got %q", ProviderDocumentation, annotations[airunwayv1alpha1.AnnotationDocumentationURL])
	}
	if annotations[airunwayv1alpha1.AnnotationDocumentation] != ProviderDocumentation {
		t.Fatalf("expected legacy documentation annotation %q, got %q", ProviderDocumentation, annotations[airunwayv1alpha1.AnnotationDocumentation])
	}
	if annotations[airunwayv1alpha1.AnnotationDefaultNamespace] != "kaito-workspace" {
		t.Fatalf("expected default namespace kaito-workspace, got %q", annotations[airunwayv1alpha1.AnnotationDefaultNamespace])
	}

	var installation airunwayv1alpha1.InstallationInfo
	if err := json.Unmarshal([]byte(annotations[airunwayv1alpha1.AnnotationInstallation]), &installation); err != nil {
		t.Fatalf("failed to decode installation annotation: %v", err)
	}
	if installation.DefaultNamespace != "kaito-workspace" {
		t.Fatalf("expected installation default namespace kaito-workspace, got %q", installation.DefaultNamespace)
	}

	var capabilities airunwayv1alpha1.ProviderCapabilities
	if err := json.Unmarshal([]byte(annotations[airunwayv1alpha1.AnnotationCapabilities]), &capabilities); err != nil {
		t.Fatalf("failed to decode capabilities annotation: %v", err)
	}
	if len(capabilities.Engines) == 0 || len(capabilities.ServingModes) == 0 {
		t.Fatalf("expected non-empty annotated capabilities, got %+v", capabilities)
	}

	var health struct {
		CRDs []struct {
			Name        string `json:"name"`
			DisplayName string `json:"displayName"`
		} `json:"crds"`
		OperatorPods []struct {
			Namespace string   `json:"namespace"`
			Selectors []string `json:"selectors"`
		} `json:"operatorPods"`
	}
	if err := json.Unmarshal([]byte(annotations[airunwayv1alpha1.AnnotationHealth]), &health); err != nil {
		t.Fatalf("failed to decode health annotation: %v", err)
	}
	if len(health.CRDs) != 1 || health.CRDs[0].Name != "workspaces.kaito.sh" || health.CRDs[0].DisplayName != "KAITO workspace CRD" {
		t.Fatalf("unexpected CRD health metadata: %+v", health.CRDs)
	}
	if len(health.OperatorPods) != 1 || health.OperatorPods[0].Namespace != "kaito-workspace" || len(health.OperatorPods[0].Selectors) != 2 {
		t.Fatalf("unexpected operator pod health metadata: %+v", health.OperatorPods)
	}
}

func TestRegisterNew(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = airunwayv1alpha1.AddToScheme(scheme)

	c := fake.NewClientBuilder().WithScheme(scheme).WithStatusSubresource(&airunwayv1alpha1.InferenceProviderConfig{}).Build()
	mgr := NewProviderConfigManager(c)

	err := mgr.Register(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRegisterExisting(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = airunwayv1alpha1.AddToScheme(scheme)

	existing := &airunwayv1alpha1.InferenceProviderConfig{
		ObjectMeta: metav1.ObjectMeta{Name: ProviderConfigName},
	}

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(existing).WithStatusSubresource(existing).Build()
	mgr := NewProviderConfigManager(c)

	err := mgr.Register(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestUpdateStatus(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = airunwayv1alpha1.AddToScheme(scheme)

	existing := &airunwayv1alpha1.InferenceProviderConfig{
		ObjectMeta: metav1.ObjectMeta{Name: ProviderConfigName},
	}

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(existing).WithStatusSubresource(existing).Build()
	mgr := NewProviderConfigManager(c)

	err := mgr.UpdateStatus(context.Background(), true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestUnregister(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = airunwayv1alpha1.AddToScheme(scheme)

	existing := &airunwayv1alpha1.InferenceProviderConfig{
		ObjectMeta: metav1.ObjectMeta{Name: ProviderConfigName},
	}

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(existing).WithStatusSubresource(existing).Build()
	mgr := NewProviderConfigManager(c)

	err := mgr.Unregister(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestStartHeartbeat(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = airunwayv1alpha1.AddToScheme(scheme)

	existing := &airunwayv1alpha1.InferenceProviderConfig{
		ObjectMeta: metav1.ObjectMeta{Name: ProviderConfigName},
	}

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(existing).WithStatusSubresource(existing).Build()
	mgr := NewProviderConfigManager(c)

	ctx, cancel := context.WithCancel(context.Background())
	mgr.StartHeartbeat(ctx)
	// Cancel immediately to stop the goroutine
	cancel()
}

func TestUpdateStatusNotFound(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = airunwayv1alpha1.AddToScheme(scheme)

	c := fake.NewClientBuilder().WithScheme(scheme).Build()
	mgr := NewProviderConfigManager(c)

	err := mgr.UpdateStatus(context.Background(), true)
	if err == nil {
		t.Fatal("expected error when config not found")
	}
}
