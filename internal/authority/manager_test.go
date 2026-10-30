package authority

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/EveMissLab/EveComputeField/internal/field"
)

func spec(id string) field.Spec {
	return field.Spec{Version: field.ProtocolVersion, FieldID: id, UnitCount: 360,
		Domains: []field.MemoryDomain{{ID: "volatile", Kind: "volatile", QuotaBytes: 1000}, {ID: "durable", Kind: "snapshot", QuotaBytes: 1000}},
		Tasks:   []field.Task{{ID: "a", Op: "sum", Inputs: []float64{2, 3}}, {ID: "b", Op: "mul", Inputs: []float64{2}, DependsOn: []string{"a"}}},
	}
}

func TestPersistentFieldLifecycle(t *testing.T) {
	path := t.TempDir()
	a, err := Open(path, map[string]field.Executor{"local": field.LocalExecutor{}}, 2)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.Create(spec("one")); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Create(spec("two")); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Create(spec("one")); !errors.Is(err, ErrExists) {
		t.Fatalf("duplicate create: %v", err)
	}
	if len(a.List()) != 2 || a.List()[0].FieldID != "one" {
		t.Fatalf("list: %v", a.List())
	}
	if err := a.Put("one", "durable", "remember", "yes"); err != nil {
		t.Fatal(err)
	}
	if err := a.Put("one", "volatile", "temp", "gone"); err != nil {
		t.Fatal(err)
	}
	r1, err := a.Run(context.Background(), "one")
	if err != nil || r1.Epoch != 1 || r1.Results["b"] != 10 {
		t.Fatalf("run1: %+v %v", r1, err)
	}
	r2, err := a.Run(context.Background(), "one")
	if err != nil || r2.Epoch != 2 {
		t.Fatalf("run2: %+v %v", r2, err)
	}
	fresh, err := Open(path, map[string]field.Executor{"local": field.LocalExecutor{}}, 2)
	if err != nil {
		t.Fatal(err)
	}
	view, err := fresh.Inspect("one")
	if err != nil || view.Epoch != 2 || view.Results["b"] != 10 || view.LogicalUnits != 360 {
		t.Fatalf("restore: %+v %v", view, err)
	}
	v, ok, err := fresh.Get("one", "durable", "remember")
	if err != nil || !ok || v != "yes" {
		t.Fatalf("durable: %q %v %v", v, ok, err)
	}
	if _, ok, _ := fresh.Get("one", "volatile", "temp"); ok {
		t.Fatal("volatile state survived restart")
	}
	if v, _ := fresh.Inspect("two"); v.Epoch != 0 {
		t.Fatal("independent field epoch mutated")
	}
}

func TestFailedRunNeverCommitsOrAdvancesEpoch(t *testing.T) {
	p := t.TempDir()
	a, err := Open(p, map[string]field.Executor{"local": field.LocalExecutor{}}, 2)
	if err != nil {
		t.Fatal(err)
	}
	s := spec("failed")
	s.Tasks[1].Node = "missing"
	if _, err := a.Create(s); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Run(context.Background(), "failed"); err == nil {
		t.Fatal("missing backend accepted")
	}
	view, err := a.Inspect("failed")
	if err != nil || view.Epoch != 0 || len(view.Results) != 0 {
		t.Fatalf("in-memory partial commit %+v %v", view, err)
	}
	fresh, err := Open(p, map[string]field.Executor{"local": field.LocalExecutor{}}, 2)
	if err != nil {
		t.Fatal(err)
	}
	view, err = fresh.Inspect("failed")
	if err != nil || view.Epoch != 0 || len(view.Results) != 0 {
		t.Fatalf("disk partial commit %+v %v", view, err)
	}
}

func TestConcurrentRunSerializesPerField(t *testing.T) {
	a, err := Open(t.TempDir(), map[string]field.Executor{"local": field.LocalExecutor{}}, 4)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.Create(spec("concurrent")); err != nil {
		t.Fatal(err)
	}
	const n = 20
	var wg sync.WaitGroup
	errs := make(chan error, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, err := a.Run(context.Background(), "concurrent"); errs <- err }()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	v, err := a.Inspect("concurrent")
	if err != nil || v.Epoch != n {
		t.Fatalf("lost epochs %+v %v", v, err)
	}
}

func TestInvalidStateAndRootReject(t *testing.T) {
	path := t.TempDir()
	a, _ := Open(path, map[string]field.Executor{"local": field.LocalExecutor{}}, 2)
	if _, err := a.Create(spec("../breakout")); err == nil {
		t.Fatal("path traversal allowed")
	}
	if _, err := a.Inspect("missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("not found %v", err)
	}
	if _, err := a.Create(spec("valid")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(path, "valid", "state.json"), []byte(`{"tamper":true}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(path, map[string]field.Executor{"local": field.LocalExecutor{}}, 2); err == nil {
		t.Fatal("corrupt snapshot silently accepted")
	}
}

func TestSnapshotWriteFailureCannotCommit(t *testing.T) {
	a, err := Open(t.TempDir(), map[string]field.Executor{"local": field.LocalExecutor{}}, 2)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.Create(spec("one")); err != nil {
		t.Fatal(err)
	}
	// Remove field data directory; an atomic snapshot cannot commit without it.
	if err := os.RemoveAll(filepath.Join(a.Root(), "one")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(a.Root(), "one"), []byte("blocking file"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Run(context.Background(), "one"); err == nil {
		t.Fatal("run committed despite failed snapshot")
	}
	v, err := a.Inspect("one")
	if err != nil || v.Epoch != 0 {
		t.Fatalf("partial in-memory update %+v %v", v, err)
	}
}
