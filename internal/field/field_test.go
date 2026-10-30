package field

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func testSpec() Spec {
	return Spec{Version: ProtocolVersion, FieldID: "test-field", UnitCount: 360,
		Domains: []MemoryDomain{{ID: "scratch", Kind: "volatile", QuotaBytes: 1024}, {ID: "continuity", Kind: "snapshot", QuotaBytes: 1024}},
		Tasks: []Task{
			{ID: "a", Op: "sum", Inputs: []float64{2, 3}},
			{ID: "b", Op: "mul", Inputs: []float64{4, 5}},
			{ID: "c", Op: "sum", Inputs: []float64{1}, DependsOn: []string{"a", "b"}},
		},
	}
}
func TestValidationGood(t *testing.T) {
	if err := testSpec().Validate(); err != nil {
		t.Fatal(err)
	}
}
func TestCycleRejected(t *testing.T) {
	s := testSpec()
	s.Tasks[0].DependsOn = []string{"c"}
	if err := s.Validate(); err == nil {
		t.Fatal("expected cycle error")
	}
}
func TestUnknownDependencyRejected(t *testing.T) {
	s := testSpec()
	s.Tasks[1].DependsOn = []string{"missing"}
	if err := s.Validate(); err == nil {
		t.Fatal("expected unknown dependency error")
	}
}
func TestDuplicateAndDisallowedRejected(t *testing.T) {
	s := testSpec()
	s.Tasks[1].ID = "a"
	if err := s.Validate(); err == nil {
		t.Fatal("duplicate task allowed")
	}
	s = testSpec()
	s.Tasks[0].Op = "shell"
	if err := s.Validate(); err == nil {
		t.Fatal("disallowed op allowed")
	}
}
func TestUnitCountGuardrail(t *testing.T) {
	s := testSpec()
	s.UnitCount = MaxLogicalUnits + 1
	if err := s.Validate(); err == nil {
		t.Fatal("unbounded reference allocation")
	}
}
func TestDeterministicLayers(t *testing.T) {
	s := testSpec()
	got, err := s.Layers()
	if err != nil {
		t.Fatal(err)
	}
	want := [][]string{{"a", "b"}, {"c"}}
	names := [][]string{}
	for _, layer := range got {
		n := []string{}
		for _, x := range layer {
			n = append(n, x.ID)
		}
		names = append(names, n)
	}
	if !reflect.DeepEqual(names, want) {
		t.Fatalf("layers=%v want=%v", names, want)
	}
}
func TestRunAndEpoch(t *testing.T) {
	s := testSpec()
	state, _ := NewState(s)
	backends := map[string]Executor{"local": LocalExecutor{}}
	out, err := ExecuteRun(context.Background(), s, state, backends, 4)
	if err != nil {
		t.Fatal(err)
	}
	if out.Results["c"] != 26 || out.Epoch != 1 || out.Layers != 2 {
		t.Fatalf("unexpected results %+v", out)
	}
	_, err = ExecuteRun(context.Background(), s, state, backends, 1)
	if err != nil || state.Epoch != 2 {
		t.Fatalf("second run: %v %+v", err, state)
	}
}
func TestFailedRunDoesNotCommit(t *testing.T) {
	s := testSpec()
	s.Tasks[2].Node = "missing"
	state, _ := NewState(s)
	_, err := ExecuteRun(context.Background(), s, state, map[string]Executor{"local": LocalExecutor{}}, 4)
	if err == nil {
		t.Fatal("expected backend error")
	}
	if state.Epoch != 0 || len(state.Results) != 0 {
		t.Fatal("partial committed state")
	}
}
func TestCancellation(t *testing.T) {
	s := testSpec()
	state, _ := NewState(s)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := ExecuteRun(ctx, s, state, map[string]Executor{"local": LocalExecutor{}}, 2)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected canceled, got %v", err)
	}
	if state.Epoch != 0 {
		t.Fatal("epoch committed after cancellation")
	}
}
func TestSnapshotAndVolatile(t *testing.T) {
	s := testSpec()
	state, _ := NewState(s)
	if err := state.Put(s, "scratch", "tmp", "not-persistent"); err != nil {
		t.Fatal(err)
	}
	if err := state.Put(s, "continuity", "saved", "yes"); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "snapshot.json")
	if err := state.Save(s, path); err != nil {
		t.Fatal(err)
	}
	got, err := LoadState(s, path)
	if err != nil {
		t.Fatal(err)
	}
	if v, ok, _ := got.Get(s, "continuity", "saved"); !ok || v != "yes" {
		t.Fatalf("missing persisted state %v %v", ok, v)
	}
	if _, ok, _ := got.Get(s, "scratch", "tmp"); ok {
		t.Fatal("volatile domain persisted")
	}
	if st, err := os.Stat(path); err != nil || st.Size() == 0 {
		t.Fatalf("bad snapshot: %v", err)
	}
}
func TestQuotaDenied(t *testing.T) {
	s := testSpec()
	s.Domains[0].QuotaBytes = 3
	state, _ := NewState(s)
	if err := state.Put(s, "scratch", "foo", "1"); err == nil {
		t.Fatal("expected quota denial")
	}
}
func TestSpecMismatchRejectsRestore(t *testing.T) {
	s := testSpec()
	state, _ := NewState(s)
	path := filepath.Join(t.TempDir(), "snapshot.json")
	if err := state.Save(s, path); err != nil {
		t.Fatal(err)
	}
	s.UnitCount++
	if _, err := LoadState(s, path); err == nil {
		t.Fatal("accepted different spec")
	}
}
func TestResizeUnitIdentity(t *testing.T) {
	s := testSpec()
	state, _ := NewState(s)
	before, _ := s.UnitID(4)
	ns, err := state.Reconfigure(s, 720)
	if err != nil {
		t.Fatal(err)
	}
	after, _ := ns.UnitID(4)
	if before != after || ns.UnitCount != 720 || state.SpecDigest != ns.Digest() {
		t.Fatal("reconfigure changed surviving identity")
	}
	if _, err := ns.UnitID(720); err == nil {
		t.Fatal("out of range unit accepted")
	}
}
func TestUnknownJSONFieldDenied(t *testing.T) {
	b := []byte(`{"version":"field/v0.1","field_id":"x","unit_count":1,"memory_domains":[],"tasks":[],"unexpected":true}`)
	if _, err := ParseJSON(b); err == nil {
		t.Fatal("unknown field accepted")
	}
}
