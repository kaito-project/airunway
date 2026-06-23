//go:build e2e

package gpu

import "testing"

// podCond is the anonymous condition struct used by podInfo.conditions, named
// here so the table is readable.
type podCond = struct {
	Type    string `json:"type"`
	Status  string `json:"status"`
	Reason  string `json:"reason"`
	Message string `json:"message"`
}

// TestUnschedulableReason pins the phase-1 classifier's decision logic — the
// site of the false-FAIL bug where a scheduled-but-image-pulling pod was treated
// as unschedulable. A pod is only "not scheduled" when it carries an explicit
// PodScheduled=False condition; PodScheduled=True or an absent condition means
// the scheduler placed it and the Running wait owns the rest.
func TestUnschedulableReason(t *testing.T) {
	cases := []struct {
		name             string
		conditions       []podCond
		wantNotScheduled bool
		wantGPU          bool
	}{
		{
			name:             "scheduled but pulling image (no PodScheduled=False)",
			conditions:       []podCond{{Type: "PodScheduled", Status: "True"}},
			wantNotScheduled: false,
			wantGPU:          false,
		},
		{
			name:             "no conditions yet (just created)",
			conditions:       nil,
			wantNotScheduled: false,
			wantGPU:          false,
		},
		{
			name: "unschedulable for insufficient GPU",
			conditions: []podCond{{Type: "PodScheduled", Status: "False",
				Message: "0/4 nodes are available: 4 Insufficient nvidia.com/gpu."}},
			wantNotScheduled: true,
			wantGPU:          true,
		},
		{
			name: "unschedulable for a non-GPU reason (taint)",
			conditions: []podCond{{Type: "PodScheduled", Status: "False",
				Message: "0/4 nodes are available: 4 node(s) had untolerated taint."}},
			wantNotScheduled: true,
			wantGPU:          false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			pod := podInfo{phase: "Pending", conditions: tc.conditions}
			notScheduled, gpu := unschedulableReason(pod)
			if notScheduled != tc.wantNotScheduled {
				t.Errorf("notScheduled = %v, want %v", notScheduled, tc.wantNotScheduled)
			}
			if gpu != tc.wantGPU {
				t.Errorf("gpu = %v, want %v", gpu, tc.wantGPU)
			}
		})
	}
}
