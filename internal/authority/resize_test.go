package authority

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/EveMissLab/EveComputeField/internal/field"
)

func TestM2ResizeKeepsIdentityDataAndResults(t *testing.T) {
	root := t.TempDir()
	m, err := Open(root, map[string]field.Executor{"local": field.LocalExecutor{}}, 2)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.Create(spec("one")); err != nil {
		t.Fatal(err)
	}
	if err := m.Put("one", "durable", "hello", "world"); err != nil {
		t.Fatal(err)
	}
	if err := m.Put("one", "volatile", "temporary", "value"); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Run(context.Background(), "one"); err != nil {
		t.Fatal(err)
	}
	before, _ := m.Inspect("one")
	resized, err := m.Resize("one", 720)
	if err != nil {
		t.Fatal(err)
	}
	if resized.LogicalUnits != 720 || resized.Epoch != before.Epoch || resized.Results["b"] != 10 || resized.SpecDigest == before.SpecDigest {
		t.Fatalf("bad resize: before=%+v after=%+v", before, resized)
	}
	if val, ok, _ := m.Get("one", "volatile", "temporary"); !ok || val != "value" {
		t.Fatalf("volatile lost in-process %q", val)
	}
	if val, ok, _ := m.Get("one", "durable", "hello"); !ok || val != "world" {
		t.Fatalf("durable lost in-process %q", val)
	}
	if _, err := m.Run(context.Background(), "one"); err != nil {
		t.Fatal(err)
	}
	fresh, err := Open(root, map[string]field.Executor{"local": field.LocalExecutor{}}, 2)
	if err != nil {
		t.Fatal(err)
	}
	restored, _ := fresh.Inspect("one")
	if restored.LogicalUnits != 720 || restored.Epoch != 2 {
		t.Fatalf("not restored %+v", restored)
	}
	if val, ok, _ := fresh.Get("one", "durable", "hello"); !ok || val != "world" {
		t.Fatalf("durable not restored %q", val)
	}
	if _, ok, _ := fresh.Get("one", "volatile", "temporary"); ok {
		t.Fatal("volatile unexpectedly persisted")
	}
	if _, err := fresh.Resize("one", 20); err != nil {
		t.Fatal(err)
	}
	latest, _ := fresh.Inspect("one")
	if latest.LogicalUnits != 20 || latest.Epoch != 2 {
		t.Fatalf("shrink failed %+v", latest)
	}
}

func TestM2ResizeInvalidDoesNotMutate(t *testing.T) {
	m, err := Open(t.TempDir(), map[string]field.Executor{"local": field.LocalExecutor{}}, 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.Create(spec("one")); err != nil {
		t.Fatal(err)
	}
	for _, count := range []int{0, -1, field.MaxLogicalUnits + 1} {
		if _, err := m.Resize("one", count); err == nil {
			t.Fatalf("accepted %d", count)
		}
	}
	view, _ := m.Inspect("one")
	if view.LogicalUnits != 360 {
		t.Fatalf("invalid resize mutated %+v", view)
	}
	if _, err := m.Resize("no-such-field", 200); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
}

func TestM2ResizeRefusesDamagedJournal(t *testing.T) {
	root := t.TempDir()
	m, _ := Open(root, map[string]field.Executor{"local": field.LocalExecutor{}}, 1)
	if _, err := m.Create(spec("one")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "one", ".resize.pending.json"), []byte("corrupt"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(root, map[string]field.Executor{"local": field.LocalExecutor{}}, 1); err == nil {
		t.Fatal("corrupt pending journal silently ignored")
	}
}

func TestM2InterruptedResizeReplaysForward(t *testing.T) {
	root := t.TempDir()
	m, _ := Open(root, map[string]field.Executor{"local": field.LocalExecutor{}}, 1)
	if _, err := m.Create(spec("one")); err != nil {
		t.Fatal(err)
	}
	if err := m.Put("one", "durable", "p", "persist"); err != nil {
		t.Fatal(err)
	}
	e, _ := m.entry("one")
	candidate := *e.state
	next, err := candidate.Reconfigure(e.spec, 999)
	if err != nil {
		t.Fatal(err)
	}
	intent, err := newResizeIntent(next, &candidate)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(intent)
	if err != nil {
		t.Fatal(err)
	}
	directory := filepath.Join(root, "one")
	if err := writeNew(filepath.Join(directory, resizeJournalName), raw); err != nil {
		t.Fatal(err)
	}
	// Simulate interruption with new spec on disk but old state still present.
	specBytes, _ := json.Marshal(next)
	if err := writeReplace(filepath.Join(directory, "spec.json"), specBytes); err != nil {
		t.Fatal(err)
	}
	recovered, err := Open(root, map[string]field.Executor{"local": field.LocalExecutor{}}, 1)
	if err != nil {
		t.Fatal(err)
	}
	view, _ := recovered.Inspect("one")
	if view.LogicalUnits != 999 {
		t.Fatalf("forward recovery did not finish %+v", view)
	}
	value, exists, _ := recovered.Get("one", "durable", "p")
	if !exists || value != "persist" {
		t.Fatalf("lost memory: %q", value)
	}
	if _, err := os.Stat(filepath.Join(directory, resizeJournalName)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("journal not cleaned: %v", err)
	}
}
