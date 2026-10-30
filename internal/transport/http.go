package transport

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/EveMissLab/EveComputeField/internal/field"
)

const maxBodyBytes = 64 * 1024

type Request struct {
	Version string    `json:"version"`
	Op      string    `json:"op"`
	Inputs  []float64 `json:"inputs"`
}
type Response struct {
	Version string  `json:"version"`
	Value   float64 `json:"value"`
	Error   string  `json:"error,omitempty"`
}

// WorkerHandler executes only allowlisted, pure reference operations.
// The production network boundary must be enforced by the mTLS server.
func WorkerHandler() http.Handler {
	mux := http.NewServeMux()
	local := field.LocalExecutor{}
	mux.HandleFunc("/v1/capabilities", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"version":"field/v0.1","operations":["sum","mul"],"role":"stateless-worker"}`)
	})
	mux.HandleFunc("/v1/execute", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		defer r.Body.Close()
		dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes))
		dec.DisallowUnknownFields()
		var req Request
		if err := dec.Decode(&req); err != nil {
			http.Error(w, "invalid JSON request", http.StatusBadRequest)
			return
		}
		var extra any
		if err := dec.Decode(&extra); err != io.EOF {
			http.Error(w, "trailing JSON data", http.StatusBadRequest)
			return
		}
		if req.Version != field.ProtocolVersion || len(req.Inputs) > 4096 {
			http.Error(w, "unsupported version or input size", http.StatusBadRequest)
			return
		}
		val, err := local.Execute(r.Context(), req.Op, req.Inputs)
		if err != nil {
			http.Error(w, "disallowed operation or invalid result", http.StatusUnprocessableEntity)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(Response{Version: field.ProtocolVersion, Value: val})
	})
	return mux
}

func ServerTLSConfig(caPath, certPath, keyPath string) (*tls.Config, error) {
	ca, err := os.ReadFile(caPath)
	if err != nil {
		return nil, err
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(ca) {
		return nil, errors.New("invalid client CA PEM")
	}
	cert, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		return nil, err
	}
	return &tls.Config{MinVersion: tls.VersionTLS13, ClientCAs: roots, ClientAuth: tls.RequireAndVerifyClientCert, Certificates: []tls.Certificate{cert}}, nil
}

func NewRemoteExecutor(baseURL, caPath, certPath, keyPath string) (*RemoteExecutor, error) {
	ca, err := os.ReadFile(caPath)
	if err != nil {
		return nil, err
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(ca) {
		return nil, errors.New("invalid worker CA PEM")
	}
	cert, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		return nil, err
	}
	if len(baseURL) < 9 || baseURL[:8] != "https://" {
		return nil, errors.New("remote executor requires https URL")
	}
	tr := &http.Transport{TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS13, RootCAs: roots, Certificates: []tls.Certificate{cert}}}
	return &RemoteExecutor{BaseURL: baseURL, Client: &http.Client{Timeout: 10 * time.Second, Transport: tr}}, nil
}

type RemoteExecutor struct {
	BaseURL string
	Client  *http.Client
}

func (e *RemoteExecutor) Execute(ctx context.Context, op string, inputs []float64) (float64, error) {
	reqBody, err := json.Marshal(Request{Version: field.ProtocolVersion, Op: op, Inputs: inputs})
	if err != nil {
		return 0, err
	}
	if len(reqBody) > maxBodyBytes {
		return 0, errors.New("request payload too large")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, e.BaseURL+"/v1/execute", bytes.NewReader(reqBody))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := e.Client.Do(req)
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("worker returned HTTP %d", res.StatusCode)
	}
	var out Response
	dec := json.NewDecoder(io.LimitReader(res.Body, maxBodyBytes))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&out); err != nil {
		return 0, err
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		return 0, errors.New("trailing worker response")
	}
	if out.Version != field.ProtocolVersion || out.Error != "" {
		return 0, errors.New("invalid worker protocol response")
	}
	return out.Value, nil
}
