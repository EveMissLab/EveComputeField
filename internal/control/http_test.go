package control

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/EveMissLab/EveComputeField/internal/authority"
	"github.com/EveMissLab/EveComputeField/internal/field"
)

const testToken = "test-only-replace-this-with-32-bytes-of-entropy"

func TestAuthenticatedControlAPI(t *testing.T) {
	mgr, err := authority.Open(t.TempDir(), map[string]field.Executor{"local": field.LocalExecutor{}}, 2)
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(NewHandler(mgr, testToken))
	defer ts.Close()
	client := ts.Client()
	request := func(method, path, body, token string) *http.Response {
		t.Helper()
		req, err := http.NewRequestWithContext(context.Background(), method, ts.URL+path, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return resp
	}
	s := field.Spec{Version: field.ProtocolVersion, FieldID: "alpha", UnitCount: 360, Domains: []field.MemoryDomain{{ID: "saved", Kind: "snapshot", QuotaBytes: 500}}, Tasks: []field.Task{{ID: "result", Op: "sum", Inputs: []float64{1, 2}}}}
	b, _ := json.Marshal(s)
	r := request("POST", "/v1/fields", string(b), "")
	if r.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anonymous %v", r.StatusCode)
	}
	r.Body.Close()
	r = request("POST", "/v1/fields", string(b), "wrong")
	if r.StatusCode != http.StatusUnauthorized {
		t.Fatalf("wrong token %v", r.StatusCode)
	}
	r.Body.Close()
	r = request("POST", "/v1/fields", string(b), testToken)
	if r.StatusCode != http.StatusCreated {
		t.Fatalf("create %v", r.StatusCode)
	}
	r.Body.Close()
	r = request("POST", "/v1/fields", string(b), testToken)
	if r.StatusCode != http.StatusConflict {
		t.Fatalf("duplicate %v", r.StatusCode)
	}
	r.Body.Close()
	r = request("POST", "/v1/fields/alpha/run", "", testToken)
	if r.StatusCode != http.StatusOK {
		t.Fatalf("run %v", r.StatusCode)
	}
	r.Body.Close()
	r = request("PUT", "/v1/fields/alpha/memory/saved/hello", `{"value":"world"}`, testToken)
	if r.StatusCode != http.StatusNoContent {
		t.Fatalf("put %v", r.StatusCode)
	}
	r.Body.Close()
	r = request("GET", "/v1/fields/alpha/memory/saved/hello", "", testToken)
	if r.StatusCode != http.StatusOK {
		t.Fatalf("get %v", r.StatusCode)
	}
	r.Body.Close()
	r = request("GET", "/v1/fields/alpha", "", testToken)
	if r.StatusCode != http.StatusOK {
		t.Fatalf("inspect %v", r.StatusCode)
	}
	var v authority.View
	if err := json.NewDecoder(r.Body).Decode(&v); err != nil {
		t.Fatal(err)
	}
	r.Body.Close()
	if v.Epoch != 1 || v.Results["result"] != 3 {
		t.Fatalf("view %+v", v)
	}
	r = request("GET", "/v1/fields", "", testToken)
	if r.StatusCode != http.StatusOK {
		t.Fatalf("list %v", r.StatusCode)
	}
	r.Body.Close()
	r = request("POST", "/v1/fields/alpha/run", "", testToken)
	r.Body.Close()
	v, _ = mgr.Inspect("alpha")
	if v.Epoch != 2 {
		t.Fatalf("epochs %+v", v)
	}
}

func TestControlRejectsMalformedAndUnsafe(t *testing.T) {
	mgr, _ := authority.Open(t.TempDir(), map[string]field.Executor{"local": field.LocalExecutor{}}, 2)
	h := NewHandler(mgr, testToken)
	calls := []struct {
		method, path, body, auth, origin string
		want                             int
	}{
		{"GET", "/v1/fields", "", "", "", 401},
		{"GET", "/v1/fields", "", "Bearer " + testToken, "https://attacker.invalid", 403},
		{"POST", "/v1/fields", `{"unknown":true}`, "Bearer " + testToken, "", 400},
		{"POST", "/v1/fields", strings.Repeat("x", 1024*1024+5), "Bearer " + testToken, "", 400},
		{"PUT", "/v1/fields/a/memory/d/k", `{"value":12}`, "Bearer " + testToken, "", 400},
		{"GET", "/v1/fields/%2e%2e", "", "Bearer " + testToken, "", 404},
		{"DELETE", "/v1/fields", "", "Bearer " + testToken, "", 405},
	}
	for _, c := range calls {
		r := httptest.NewRequest(c.method, c.path, bytes.NewBufferString(c.body))
		r.Header.Set("Authorization", c.auth)
		if c.origin != "" {
			r.Header.Set("Origin", c.origin)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != c.want {
			t.Errorf("%s %s: %d want %d", c.method, c.path, w.Code, c.want)
		}
	}
	if err := ValidateListen("0.0.0.0:8080"); err == nil {
		t.Fatal("non-loopback accepted")
	}
	if err := ValidateListen("127.0.0.1:8080"); err != nil {
		t.Fatal(err)
	}
	if err := ValidateListen("[::1]:8080"); err != nil {
		t.Fatal(err)
	}
}
