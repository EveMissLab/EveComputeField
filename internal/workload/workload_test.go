package workload

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestHelperWorkloadProcess(t *testing.T) {
	if len(os.Args) == 0 || os.Args[len(os.Args)-1] != "m2-test-helper" {
		return
	}
	raw, _ := io.ReadAll(os.Stdin)
	switch string(raw) {
	case "sleep":
		time.Sleep(time.Second)
	case "huge":
		io.WriteString(os.Stdout, strings.Repeat("X", 10000))
	case "fail":
		os.Exit(9)
	default:
		os.Stdout.Write([]byte("OK:"))
		os.Stdout.Write(raw)
	}
	os.Exit(0)
}

func helperDefinition(t *testing.T) Definition {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	abs, err := filepath.Abs(exe)
	if err != nil {
		t.Fatal(err)
	}
	return Definition{Name: "helper", Program: abs, Args: []string{"-test.run=TestHelperWorkloadProcess", "m2-test-helper"}, TimeoutMS: 2000, MaxOutputBytes: 200}
}

func TestM2WorkloadRegistryExecutesAllowedProgramOnly(t *testing.T) {
	r, err := New([]Definition{helperDefinition(t)}, 2)
	if err != nil {
		t.Fatal(err)
	}
	out, err := r.Run(context.Background(), "helper", "world")
	if err != nil || out.Stdout != "OK:world" {
		t.Fatalf("out=%+v err=%v", out, err)
	}
	if _, err := r.Run(context.Background(), "other", "hello"); !errors.Is(err, ErrUnknown) {
		t.Fatalf("unknown workload: %v", err)
	}
	if _, err := r.Run(context.Background(), "helper", "fail"); err == nil {
		t.Fatal("nonzero exit treated as success")
	}
	if _, err := r.Run(context.Background(), "helper", "huge"); err == nil {
		t.Fatal("overlarge output accepted")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if _, err := r.Run(ctx, "helper", "sleep"); err == nil {
		t.Fatal("timeout not enforced")
	}
}

func TestM2WorkloadRegistryRejectsUnsafeDefinitions(t *testing.T) {
	valid := helperDefinition(t)
	tests := []Definition{
		{Name: "bad", Program: "relative/program", TimeoutMS: 100, MaxOutputBytes: 10},
		{Name: "", Program: valid.Program, TimeoutMS: 100, MaxOutputBytes: 10},
		{Name: "valid", Program: valid.Program, Args: []string{"bad\x00arg"}, TimeoutMS: 100, MaxOutputBytes: 10},
		{Name: "valid", Program: valid.Program, TimeoutMS: 0, MaxOutputBytes: 10},
		{Name: "valid", Program: valid.Program, TimeoutMS: 100, MaxOutputBytes: 1 << 30},
	}
	for _, d := range tests {
		if _, err := New([]Definition{d}, 1); err == nil {
			t.Errorf("invalid definition allowed %+v", d)
		}
	}
	if _, err := New([]Definition{valid, valid}, 1); err == nil {
		t.Fatal("duplicate name allowed")
	}
	if _, err := New([]Definition{valid}, 0); err == nil {
		t.Fatal("unbounded concurrency allowed")
	}
}
