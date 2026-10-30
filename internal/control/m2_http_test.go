package control

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/EveMissLab/EveComputeField/internal/authority"
	"github.com/EveMissLab/EveComputeField/internal/field"
	"github.com/EveMissLab/EveComputeField/internal/workload"
)

func TestControlWorkloadHelper(t *testing.T) {
	if len(os.Args) < 1 || os.Args[len(os.Args)-1] != "m2-control-helper" {
		return
	}
	data, _ := io.ReadAll(os.Stdin)
	os.Stdout.Write([]byte("processed:"))
	os.Stdout.Write(data)
	os.Exit(0)
}

func TestM2LocalControlResizeInvokeAndPersistence(t *testing.T) {
	dir := t.TempDir()
	mgr, err := authority.Open(dir, map[string]field.Executor{"local": field.LocalExecutor{}}, 2)
	if err != nil {
		t.Fatal(err)
	}
	s := field.Spec{Version: field.ProtocolVersion, FieldID: "alpha", UnitCount: 360,
		Domains: []field.MemoryDomain{{ID: "durable", Kind: "snapshot", QuotaBytes: 1000}}}
	if _, err := mgr.Create(s); err != nil {
		t.Fatal(err)
	}
	exe, _ := os.Executable()
	runner, err := workload.New([]workload.Definition{{Name: "test", Program: exe, Args: []string{"-test.run=TestControlWorkloadHelper", "m2-control-helper"}, TimeoutMS: 2000, MaxOutputBytes: 1024}}, 2)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewHandlerWithWorkloads(mgr, testToken, runner))
	defer server.Close()
	request := func(method, path, payload, token string) *http.Response {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		req, err := http.NewRequestWithContext(ctx, method, server.URL+path, bytes.NewReader([]byte(payload)))
		if err != nil {
			t.Fatal(err)
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return resp
	}
	r := request("GET", "/v1/status", "", testToken)
	if r.StatusCode != 200 {
		t.Fatalf("status %d", r.StatusCode)
	}
	r.Body.Close()
	r = request("PUT", "/v1/fields/alpha/resize", `{"unit_count":720}`, "wrong")
	if r.StatusCode != 401 {
		t.Fatalf("unauthorized resize %d", r.StatusCode)
	}
	r.Body.Close()
	r = request("PUT", "/v1/fields/alpha/resize", `{"unit_count":720}`, testToken)
	if r.StatusCode != 200 {
		t.Fatalf("resize %d", r.StatusCode)
	}
	r.Body.Close()
	r = request("POST", "/v1/fields/alpha/invoke/test", `{"input":"hello","save_domain":"durable","save_key":"last"}`, testToken)
	if r.StatusCode != 200 {
		t.Fatalf("invoke %d", r.StatusCode)
	}
	var result workload.Result
	if err := json.NewDecoder(r.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	r.Body.Close()
	if result.Stdout != "processed:hello" || !result.Saved {
		t.Fatalf("bad output %+v", result)
	}
	r = request("GET", "/v1/fields/alpha/memory/durable/last", "", testToken)
	if r.StatusCode != 200 {
		t.Fatalf("saved %d", r.StatusCode)
	}
	r.Body.Close()
	fresh, err := authority.Open(dir, map[string]field.Executor{"local": field.LocalExecutor{}}, 2)
	if err != nil {
		t.Fatal(err)
	}
	v, _ := fresh.Inspect("alpha")
	if v.LogicalUnits != 720 {
		t.Fatal("resize not restored")
	}
	value, ok, err := fresh.Get("alpha", "durable", "last")
	if err != nil || !ok || value != "processed:hello" {
		t.Fatalf("invoke not persisted %q %v %v", value, ok, err)
	}
	r = request("POST", "/v1/fields/alpha/invoke/unknown", `{"input":"hello"}`, testToken)
	if r.StatusCode != 404 {
		t.Fatalf("unregistered process executed: %d", r.StatusCode)
	}
	r.Body.Close()
	r = request("PUT", "/v1/fields/alpha/resize", `{"unit_count":0}`, testToken)
	if r.StatusCode != 422 {
		t.Fatalf("invalid resize %d", r.StatusCode)
	}
	r.Body.Close()
}
