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

package v1alpha1

import (
	"testing"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/runtime"
)

// TestAgentDeployment_DeepCopy is a smoke test that the generated
// DeepCopy methods produce an independent object. Catches accidental
// shallow copies introduced by hand-edited zz_generated files.
func TestAgentDeployment_DeepCopy(t *testing.T) {
	runAsNonRoot := true
	readOnlyRootFS := true
	noPrivEsc := false
	orig := &AgentDeployment{
		Spec: AgentDeploymentSpec{
			Framework: AgentFrameworkRef{Name: "kagent"},
			Models: []ModelBinding{
				{
					Name:          "default",
					DeploymentRef: &ModelDeploymentBinding{Name: "llama-3-8b"},
				},
			},
			Config: &runtime.RawExtension{Raw: []byte(`{"systemPrompt":"hi"}`)},
			Security: &AgentSecuritySpec{
				PodSecurityStandard: PodSecurityStandardRestricted,
				SecurityContext: &corev1.PodSecurityContext{
					RunAsNonRoot: &runAsNonRoot,
				},
				ContainerSecurityContext: &corev1.SecurityContext{
					ReadOnlyRootFilesystem:   &readOnlyRootFS,
					AllowPrivilegeEscalation: &noPrivEsc,
				},
			},
		},
	}
	cp := orig.DeepCopy()
	if cp == orig {
		t.Fatal("DeepCopy returned the same pointer")
	}
	if &cp.Spec.Models[0] == &orig.Spec.Models[0] {
		t.Error("Models slice should be a fresh allocation, not shared")
	}
	if cp.Spec.Models[0].DeploymentRef == orig.Spec.Models[0].DeploymentRef {
		t.Error("Models[0].DeploymentRef should be a fresh allocation, not shared")
	}
	if cp.Spec.Config == orig.Spec.Config {
		t.Error("Config RawExtension should be a fresh allocation, not shared")
	}
	if cp.Spec.Security == orig.Spec.Security {
		t.Error("Security should be a fresh allocation, not shared")
	}
	if cp.Spec.Security.ContainerSecurityContext == orig.Spec.Security.ContainerSecurityContext {
		t.Error("ContainerSecurityContext should be a fresh allocation, not shared")
	}
	if cp.Spec.Security.ContainerSecurityContext.ReadOnlyRootFilesystem ==
		orig.Spec.Security.ContainerSecurityContext.ReadOnlyRootFilesystem {
		t.Error("ContainerSecurityContext.ReadOnlyRootFilesystem pointer should be a fresh allocation, not shared")
	}

	// Mutating the copy must not affect the original.
	cp.Spec.Framework.Name = "openclaw"
	if orig.Spec.Framework.Name != "kagent" {
		t.Errorf("mutating copy leaked into original: %q", orig.Spec.Framework.Name)
	}
	cp.Spec.Models[0].Name = "changed"
	if orig.Spec.Models[0].Name != "default" {
		t.Errorf("mutating copy Models[0].Name leaked into original: %q", orig.Spec.Models[0].Name)
	}
}

// TestAgentDeployment_DeepCopyObject confirms the runtime.Object
// interface is satisfied (so the type can be registered with a scheme).
func TestAgentDeployment_DeepCopyObject(t *testing.T) {
	var _ runtime.Object = (*AgentDeployment)(nil)
	var _ runtime.Object = (*AgentDeploymentList)(nil)
}

// TestAgentDeploymentConditionTypes pins the user-facing condition
// names so accidental renames don't silently break the dashboard,
// providers, or kubectl printcolumns.
func TestAgentDeploymentConditionTypes(t *testing.T) {
	tests := []struct {
		got, want string
	}{
		{AgentConditionTypeModelBound, "ModelBound"},
		{AgentConditionTypeFrameworkReady, "FrameworkReady"},
		{AgentConditionTypeProviderReady, "ProviderReady"},
		{AgentConditionTypeReady, "Ready"},
	}
	for _, tt := range tests {
		if tt.got != tt.want {
			t.Errorf("condition type drift: got %q, want %q", tt.got, tt.want)
		}
	}
}
