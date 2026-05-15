package llmd

import (
	"encoding/json"
	"testing"

	airunwayv1alpha1 "github.com/kaito-project/airunway/controller/api/v1alpha1"
)

func TestGetProviderConfigSpec(t *testing.T) {
	spec := GetProviderConfigSpec()

	if len(spec.SelectionRules) != 0 {
		t.Errorf("expected no selection rules (never auto-selected), got %d", len(spec.SelectionRules))
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
	if len(info.Steps) == 0 {
		t.Error("expected installation steps")
	}
}

func TestProviderDocumentation(t *testing.T) {
	if ProviderDocumentation == "" {
		t.Error("expected documentation URL")
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
	if annotations[airunwayv1alpha1.AnnotationDefaultNamespace] != "default" {
		t.Fatalf("expected default namespace default, got %q", annotations[airunwayv1alpha1.AnnotationDefaultNamespace])
	}

	var installation airunwayv1alpha1.InstallationInfo
	if err := json.Unmarshal([]byte(annotations[airunwayv1alpha1.AnnotationInstallation]), &installation); err != nil {
		t.Fatalf("failed to decode installation annotation: %v", err)
	}
	if installation.Description == "" {
		t.Fatal("expected annotated installation description")
	}

	var capabilities airunwayv1alpha1.ProviderCapabilities
	if err := json.Unmarshal([]byte(annotations[airunwayv1alpha1.AnnotationCapabilities]), &capabilities); err != nil {
		t.Fatalf("failed to decode capabilities annotation: %v", err)
	}
	if len(capabilities.Engines) == 0 || len(capabilities.ServingModes) == 0 {
		t.Fatalf("expected non-empty annotated capabilities, got %+v", capabilities)
	}

	var health struct {
		Status struct {
			ReadyPath string `json:"readyPath"`
		} `json:"status"`
	}
	if err := json.Unmarshal([]byte(annotations[airunwayv1alpha1.AnnotationHealth]), &health); err != nil {
		t.Fatalf("failed to decode health annotation: %v", err)
	}
	if health.Status.ReadyPath != "ready" {
		t.Fatalf("expected readyPath ready, got %q", health.Status.ReadyPath)
	}
}
