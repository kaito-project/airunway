/*
Copyright 2026.
*/

package kaito

import (
	"context"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	storagev1 "k8s.io/api/storage/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	airunwayv1alpha1 "github.com/kaito-project/airunway/controller/api/v1alpha1"
)

// simpleMapper is a minimal REST mapper that checks the scheme for registered types.
type simpleMapper struct {
	scheme *runtime.Scheme
}

func (m *simpleMapper) RESTMapping(gk schema.GroupKind, versions ...string) (*meta.RESTMapping, error) {
	// Check if the kind is registered in the scheme
	knownTypes := m.scheme.AllKnownTypes()
	for registeredGVK := range knownTypes {
		if registeredGVK.Group == gk.Group && registeredGVK.Kind == gk.Kind {
			// Kind found in scheme
			return &meta.RESTMapping{}, nil
		}
	}
	// Kind not found in scheme; return NoKindMatchError
	return nil, &meta.NoKindMatchError{GroupKind: gk}
}

func (m *simpleMapper) RESTMappings(gk schema.GroupKind, versions ...string) ([]*meta.RESTMapping, error) {
	mapping, err := m.RESTMapping(gk, versions...)
	if err != nil {
		return nil, err
	}
	return []*meta.RESTMapping{mapping}, nil
}

func (m *simpleMapper) ResourceSingularizer(resource string) (singular string, err error) {
	return resource, nil
}

func (m *simpleMapper) ResourcesFor(input schema.GroupVersionResource) ([]schema.GroupVersionResource, error) {
	return []schema.GroupVersionResource{input}, nil
}

func (m *simpleMapper) KindsFor(input schema.GroupVersionResource) ([]schema.GroupVersionKind, error) {
	return []schema.GroupVersionKind{
		{
			Group:   input.Group,
			Version: input.Version,
			Kind:    "Unknown",
		},
	}, nil
}

func (m *simpleMapper) ResourceFor(input schema.GroupVersionResource) (schema.GroupVersionResource, error) {
	return input, nil
}

func (m *simpleMapper) KindFor(input schema.GroupVersionResource) (schema.GroupVersionKind, error) {
	return schema.GroupVersionKind{
		Group:   input.Group,
		Version: input.Version,
		Kind:    "Unknown",
	}, nil
}

// probeTestScheme returns a scheme with the core k8s types + airunway v1alpha1.
// It intentionally does NOT register kaito.sh/Workspace — tests that need the
// CRD present should use probeTestSchemeWithWorkspace instead.
func probeTestScheme(t *testing.T) *runtime.Scheme {
	t.Helper()
	s := runtime.NewScheme()
	if err := clientgoscheme.AddToScheme(s); err != nil {
		t.Fatalf("clientgoscheme.AddToScheme: %v", err)
	}
	if err := airunwayv1alpha1.AddToScheme(s); err != nil {
		t.Fatalf("airunway AddToScheme: %v", err)
	}
	return s
}

// probeTestSchemeWithWorkspace adds the kaito.sh/Workspace GVK as an unstructured
// registration so the fake client's REST mapper will match it.
func probeTestSchemeWithWorkspace(t *testing.T) *runtime.Scheme {
	t.Helper()
	s := probeTestScheme(t)
	gvk := schema.GroupVersionKind{Group: "kaito.sh", Version: "v1beta1", Kind: "Workspace"}
	s.AddKnownTypeWithName(gvk, &metav1.PartialObjectMetadata{})
	gvkList := schema.GroupVersionKind{Group: "kaito.sh", Version: "v1beta1", Kind: "WorkspaceList"}
	s.AddKnownTypeWithName(gvkList, &metav1.PartialObjectMetadataList{})
	metav1.AddToGroupVersion(s, schema.GroupVersion{Group: "kaito.sh", Version: "v1beta1"})
	return s
}

func TestProbe_CRDMissing(t *testing.T) {
	// Scheme without kaito.sh registered — List will fail with NoKindMatchError.
	// We need to create a simple REST mapper that only knows about registered types.
	scheme := probeTestScheme(t)
	mapper := &simpleMapper{scheme: scheme}
	c := fake.NewClientBuilder().WithScheme(scheme).WithRESTMapper(mapper).Build()

	got := probeUpstreamController(context.Background(), c)

	if got.Healthy {
		t.Errorf("expected Healthy=false, got true")
	}
	if got.Reason != ReasonCRDMissing {
		t.Errorf("expected Reason=%s, got %s", ReasonCRDMissing, got.Reason)
	}
	if got.Message != crdMissingUserMessage {
		t.Errorf("unexpected Message: %s", got.Message)
	}
	// Sanity: helper stays exercised
	_ = meta.NoKindMatchError{}
	_ = client.InNamespace("")
	_ = appsv1.Deployment{}
	_ = storagev1.StorageClass{}
}
