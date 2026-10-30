// Package control offers a loopback-only authenticated management protocol.
// It is not a LAN endpoint; network workers have a separate mTLS boundary.
package control

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"

	"github.com/EveMissLab/EveComputeField/internal/authority"
	"github.com/EveMissLab/EveComputeField/internal/field"
	"github.com/EveMissLab/EveComputeField/internal/workload"
)

const maxControlBody = 1024 * 1024
const maxMemoryBody = 64 * 1024

// ValidateListen deliberately accepts only explicit loopback IP literals.
// There is no unauthenticated public/LAN control port in this release.
func ValidateListen(address string) error {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return err
	}
	if host != "127.0.0.1" && host != "::1" {
		return errors.New("control address must use 127.0.0.1 or ::1")
	}
	p, err := strconv.Atoi(port)
	if err != nil || p < 0 || p > 65535 {
		return errors.New("invalid control port")
	}
	return nil
}

func safeSegment(s string) bool {
	if s == "" || s == "." || s == ".." || len(s) > 96 {
		return false
	}
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' {
			continue
		}
		return false
	}
	return true
}

func readBody(r *http.Request, limit int64) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, errors.New("request body too large")
	}
	return data, nil
}

func respond(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func methodNotAllowed(w http.ResponseWriter) {
	http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
}
func notFound(w http.ResponseWriter) { http.Error(w, "not found", http.StatusNotFound) }
func externalError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, authority.ErrNotFound):
		notFound(w)
	case errors.Is(err, authority.ErrExists):
		http.Error(w, "field already exists", http.StatusConflict)
	case errors.Is(err, authority.ErrInvalid):
		http.Error(w, "invalid field operation", http.StatusUnprocessableEntity)
	case errors.Is(err, authority.ErrExecution):
		http.Error(w, "field execution failed", http.StatusBadGateway)
	default:
		http.Error(w, "field storage or internal error", http.StatusInternalServerError)
	}
}

// NewHandler assumes ValidateListen has been enforced by the caller. Browser
// Origin requests are denied, all requests need a high-entropy Bearer secret.
func NewHandler(manager *authority.Manager, token string) http.Handler {
	return NewHandlerWithWorkloads(manager, token, nil)
}

// NewHandlerWithWorkloads permits only named processes in the server-side
// opt-in registry; it never accepts executable paths or shell commands from HTTP.
func NewHandlerWithWorkloads(manager *authority.Manager, token string, runner *workload.Registry) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "default-src 'none'")
		expected := "Bearer " + token
		supplied := r.Header.Get("Authorization")
		if len(token) < 32 || len(supplied) != len(expected) || subtle.ConstantTimeCompare([]byte(supplied), []byte(expected)) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if r.Header.Get("Origin") != "" {
			http.Error(w, "cross-origin control requests are forbidden", http.StatusForbidden)
			return
		}
		if r.URL.RawQuery != "" {
			notFound(w)
			return
		}
		path := strings.Trim(r.URL.Path, "/")
		if path == "v1/status" {
			if r.Method != http.MethodGet {
				methodNotAllowed(w)
				return
			}
			respond(w, http.StatusOK, map[string]any{"mode": "local-first", "control_version": "control/v1", "field_count": len(manager.List()), "registered_workloads": runner.Names()})
			return
		}
		if path == "v1/workloads" {
			if r.Method != http.MethodGet {
				methodNotAllowed(w)
				return
			}
			respond(w, http.StatusOK, map[string]any{"workloads": runner.Names()})
			return
		}
		parts := strings.Split(path, "/")
		if len(parts) < 2 || parts[0] != "v1" || parts[1] != "fields" {
			notFound(w)
			return
		}
		if len(parts) == 2 {
			switch r.Method {
			case http.MethodGet:
				respond(w, http.StatusOK, map[string]any{"fields": manager.List()})
			case http.MethodPost:
				data, err := readBody(r, maxControlBody)
				if err != nil {
					http.Error(w, "invalid spec size", http.StatusBadRequest)
					return
				}
				spec, err := field.ParseJSON(data)
				if err != nil {
					http.Error(w, "invalid field spec", http.StatusBadRequest)
					return
				}
				v, err := manager.Create(spec)
				if err != nil {
					externalError(w, err)
					return
				}
				respond(w, http.StatusCreated, v)
			default:
				methodNotAllowed(w)
			}
			return
		}
		if !safeSegment(parts[2]) {
			notFound(w)
			return
		}
		id := parts[2]
		if len(parts) == 3 {
			if r.Method != http.MethodGet {
				methodNotAllowed(w)
				return
			}
			v, err := manager.Inspect(id)
			if err != nil {
				externalError(w, err)
				return
			}
			respond(w, http.StatusOK, v)
			return
		}
		if len(parts) == 4 && parts[3] == "resize" {
			if r.Method != http.MethodPut {
				methodNotAllowed(w)
				return
			}
			data, err := readBody(r, 2048)
			if err != nil {
				http.Error(w, "invalid resize request size", http.StatusBadRequest)
				return
			}
			dec := json.NewDecoder(bytes.NewReader(data))
			dec.DisallowUnknownFields()
			var request struct {
				UnitCount int `json:"unit_count"`
			}
			if err := dec.Decode(&request); err != nil {
				http.Error(w, "invalid resize JSON", http.StatusBadRequest)
				return
			}
			var tail any
			if err := dec.Decode(&tail); err != io.EOF {
				http.Error(w, "trailing resize JSON", http.StatusBadRequest)
				return
			}
			view, err := manager.Resize(id, request.UnitCount)
			if err != nil {
				externalError(w, err)
				return
			}
			respond(w, http.StatusOK, view)
			return
		}
		if len(parts) == 5 && parts[3] == "invoke" && safeSegment(parts[4]) {
			if r.Method != http.MethodPost {
				methodNotAllowed(w)
				return
			}
			if runner == nil {
				notFound(w)
				return
			}
			view, err := manager.Inspect(id)
			if err != nil {
				externalError(w, err)
				return
			}
			if view.Status != "ready" {
				http.Error(w, "field needs recovery", http.StatusServiceUnavailable)
				return
			}
			data, err := readBody(r, workload.MaxInputBytes)
			if err != nil {
				http.Error(w, "invoke request too large", http.StatusBadRequest)
				return
			}
			dec := json.NewDecoder(bytes.NewReader(data))
			dec.DisallowUnknownFields()
			var req struct {
				Input      string `json:"input"`
				SaveDomain string `json:"save_domain,omitempty"`
				SaveKey    string `json:"save_key,omitempty"`
			}
			if err := dec.Decode(&req); err != nil {
				http.Error(w, "invalid invoke JSON", http.StatusBadRequest)
				return
			}
			var tail any
			if err := dec.Decode(&tail); err != io.EOF {
				http.Error(w, "trailing invoke JSON", http.StatusBadRequest)
				return
			}
			if len(req.Input) > workload.MaxInputBytes || (req.SaveDomain == "") != (req.SaveKey == "") || req.SaveDomain != "" && (!safeSegment(req.SaveDomain) || !safeSegment(req.SaveKey)) {
				http.Error(w, "invalid input or snapshot target", http.StatusUnprocessableEntity)
				return
			}
			result, err := runner.Run(r.Context(), parts[4], req.Input)
			if err != nil {
				switch {
				case errors.Is(err, workload.ErrUnknown):
					notFound(w)
				case errors.Is(err, context.DeadlineExceeded):
					http.Error(w, "workload timed out", http.StatusGatewayTimeout)
				default:
					http.Error(w, "workload failed or output limit exceeded", http.StatusBadGateway)
				}
				return
			}
			if req.SaveDomain != "" {
				if err := manager.Put(id, req.SaveDomain, req.SaveKey, result.Stdout); err != nil {
					externalError(w, err)
					return
				}
				result.Saved = true
			}
			respond(w, http.StatusOK, result)
			return
		}
		if len(parts) == 4 && parts[3] == "run" {
			if r.Method != http.MethodPost {
				methodNotAllowed(w)
				return
			}
			data, err := readBody(r, 1)
			if err != nil || len(bytes.TrimSpace(data)) != 0 {
				http.Error(w, "run does not accept a payload", http.StatusBadRequest)
				return
			}
			report, err := manager.Run(r.Context(), id)
			if err != nil {
				externalError(w, err)
				return
			}
			respond(w, http.StatusOK, report)
			return
		}
		if len(parts) == 6 && parts[3] == "memory" && safeSegment(parts[4]) && safeSegment(parts[5]) {
			domain, key := parts[4], parts[5]
			switch r.Method {
			case http.MethodGet:
				v, ok, err := manager.Get(id, domain, key)
				if err != nil {
					externalError(w, err)
					return
				}
				if !ok {
					notFound(w)
					return
				}
				respond(w, http.StatusOK, map[string]string{"value": v})
			case http.MethodPut:
				data, err := readBody(r, maxMemoryBody)
				if err != nil {
					http.Error(w, "invalid memory value size", http.StatusBadRequest)
					return
				}
				dec := json.NewDecoder(bytes.NewReader(data))
				dec.DisallowUnknownFields()
				var payload struct {
					Value string `json:"value"`
				}
				if err := dec.Decode(&payload); err != nil {
					http.Error(w, "invalid JSON memory value", http.StatusBadRequest)
					return
				}
				var tail any
				if err := dec.Decode(&tail); err != io.EOF {
					http.Error(w, "trailing JSON data", http.StatusBadRequest)
					return
				}
				if err := manager.Put(id, domain, key, payload.Value); err != nil {
					externalError(w, err)
					return
				}
				w.WriteHeader(http.StatusNoContent)
			default:
				methodNotAllowed(w)
			}
			return
		}
		notFound(w)
	})
}
