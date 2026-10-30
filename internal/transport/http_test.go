package transport

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/EveMissLab/EveComputeField/internal/devcert"
)

func TestSafeWorkerAndMutualTLS(t *testing.T) {
	dir := t.TempDir()
	if err := devcert.Generate(dir, "127.0.0.1"); err != nil {
		t.Fatal(err)
	}
	ca := filepath.Join(dir, "ca.crt")
	serverCert := filepath.Join(dir, "worker.crt")
	serverKey := filepath.Join(dir, "worker.key")
	clientCert := filepath.Join(dir, "client.crt")
	clientKey := filepath.Join(dir, "client.key")
	cfg, err := ServerTLSConfig(ca, serverCert, serverKey)
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewUnstartedServer(WorkerHandler())
	ts.TLS = cfg
	ts.StartTLS()
	defer ts.Close()
	runner, err := NewRemoteExecutor(ts.URL, ca, clientCert, clientKey)
	if err != nil {
		t.Fatal(err)
	}
	v, err := runner.Execute(context.Background(), "sum", []float64{1, 2, 3})
	if err != nil || v != 6 {
		t.Fatalf("remote execute: %v, value=%v", err, v)
	}
	if _, err := runner.Execute(context.Background(), "shell", []float64{1}); err == nil {
		t.Fatal("remote shell operation accepted")
	}

	caPEM, err := os.ReadFile(ca)
	if err != nil {
		t.Fatal(err)
	}
	pool := x509.NewCertPool()
	pool.AppendCertsFromPEM(caPEM)
	// TLS connection with trusted server but no client cert must fail.
	client := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS13}}}
	_, err = client.Get(ts.URL + "/v1/capabilities")
	if err == nil {
		t.Fatal("unauthenticated request succeeded")
	}
}
func TestMalformedRequestDenied(t *testing.T) {
	ts := httptest.NewServer(WorkerHandler()) // Handler-level validation only; not a deployable public server.
	defer ts.Close()
	res, err := http.Post(ts.URL+"/v1/execute", "application/json", strings.NewReader(`{"version":"field/v0.1","op":"sum","inputs":[1],"surprise":true}`))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("unexpected status %v", res.StatusCode)
	}
	r2, err := http.Get(ts.URL + "/v1/capabilities")
	if err != nil {
		t.Fatal(err)
	}
	defer r2.Body.Close()
	var obj map[string]any
	if err := json.NewDecoder(r2.Body).Decode(&obj); err != nil {
		t.Fatal(err)
	}
	if obj["role"] != "stateless-worker" {
		t.Fatal("unexpected capabilities")
	}
}
