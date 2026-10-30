package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/EveMissLab/EveComputeField/internal/authority"
	"github.com/EveMissLab/EveComputeField/internal/control"
	"github.com/EveMissLab/EveComputeField/internal/field"
	"github.com/EveMissLab/EveComputeField/internal/transport"
	"github.com/EveMissLab/EveComputeField/internal/workload"
)

func tokenCommand(args []string) error {
	fs := flag.NewFlagSet("token", flag.ContinueOnError)
	out := fs.String("out", "./control.token", "new control token file (must not exist)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	var random [32]byte
	if _, err := rand.Read(random[:]); err != nil {
		return err
	}
	f, err := os.OpenFile(*out, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintln(f, hex.EncodeToString(random[:])); err != nil {
		f.Close()
		os.Remove(*out)
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		os.Remove(*out)
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return emit(map[string]string{"status": "created", "token_file": *out, "warning": "keep this file private; do not commit"})
}

func readToken(path string) (string, error) {
	if path == "" {
		return "", errors.New("-token-file is required")
	}
	info, err := os.Lstat(path)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", errors.New("control token must be a regular file")
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0077 != 0 {
		return "", errors.New("control token permissions must be owner-only (chmod 600)")
	}
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, 258))
	if err != nil {
		return "", err
	}
	token := strings.TrimSpace(string(b))
	if len(token) < 32 || len(token) > 256 {
		return "", errors.New("control token must be 32..256 characters")
	}
	return token, nil
}

func serveCommand(args []string) error {
	fs := flag.NewFlagSet("serve", flag.ContinueOnError)
	listen := fs.String("listen", "127.0.0.1:8765", "loopback control interface only")
	data := fs.String("data", "./field-data", "persistent field directory (single writer)")
	tokenPath := fs.String("token-file", "./control.token", "local bearer token file")
	parallel := fs.Int("parallel", 4, "max parallel tasks per DAG layer")
	workloadsPath := fs.String("workloads", "", "optional local trusted workload registry JSON (disabled by default)")
	workloadParallel := fs.Int("workload-parallel", 2, "max simultaneously executed registered local processes")
	ca := fs.String("ca", "", "optional trusted worker CA")
	cert := fs.String("cert", "", "optional mTLS client certificate")
	key := fs.String("key", "", "optional mTLS client key")
	var remotes remoteFlags
	fs.Var(&remotes, "remote", "optional node=https://host:8443 (repeatable)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if err := control.ValidateListen(*listen); err != nil {
		return err
	}
	token, err := readToken(*tokenPath)
	if err != nil {
		return err
	}
	backends := map[string]field.Executor{"local": field.LocalExecutor{}}
	for _, remote := range remotes {
		parts := strings.SplitN(remote, "=", 2)
		if len(parts) != 2 || parts[0] == "" || parts[0] == "local" {
			return fmt.Errorf("invalid remote mapping %q", remote)
		}
		if _, exists := backends[parts[0]]; exists {
			return fmt.Errorf("duplicate remote alias %q", parts[0])
		}
		if *ca == "" || *cert == "" || *key == "" {
			return errors.New("remote workers require -ca -cert -key")
		}
		backend, err := transport.NewRemoteExecutor(strings.TrimRight(parts[1], "/"), *ca, *cert, *key)
		if err != nil {
			return err
		}
		backends[parts[0]] = backend
	}
	var runner *workload.Registry
	if *workloadsPath != "" {
		runner, err = workload.Load(*workloadsPath, *workloadParallel)
		if err != nil {
			return fmt.Errorf("load trusted workloads: %w", err)
		}
	}
	manager, err := authority.Open(*data, backends, *parallel)
	if err != nil {
		return err
	}
	// Fail closed when another service claims the same persistence root. If a
	// process is hard-killed, manual stale lock removal requires checking first.
	lockPath := filepath.Join(manager.Root(), ".authority.lock")
	lock, err := os.OpenFile(lockPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return fmt.Errorf("cannot claim single-writer root (stale lock? verify no other daemon): %w", err)
	}
	if _, err := fmt.Fprintf(lock, "pid=%d\n", os.Getpid()); err != nil {
		lock.Close()
		os.Remove(lockPath)
		return err
	}
	lock.Close()
	defer os.Remove(lockPath)
	ln, err := net.Listen("tcp", *listen)
	if err != nil {
		return err
	}
	defer ln.Close()
	srv := &http.Server{Handler: control.NewHandlerWithWorkloads(manager, token, runner), ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 75 * time.Second, IdleTimeout: 20 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	done := make(chan error, 1)
	go func() {
		err := srv.Serve(ln)
		if errors.Is(err, http.ErrServerClosed) {
			err = nil
		}
		done <- err
	}()
	log.Printf("EveComputeField M2 control on http://%s (loopback only; field data at %s; workloads enabled=%t)", ln.Addr(), manager.Root(), runner != nil)
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := srv.Shutdown(cleanup); err != nil {
			return err
		}
		return <-done
	}
}

func ctlCommand(args []string) error {
	if len(args) < 1 {
		return errors.New("ctl requires one action: status, create, list, inspect, run, resize, workloads, invoke, get, put")
	}
	action := args[0]
	fs := flag.NewFlagSet("ctl "+action, flag.ContinueOnError)
	endpoint := fs.String("url", "http://127.0.0.1:8765", "local control URL")
	tokenPath := fs.String("token-file", "./control.token", "bearer token file")
	id := fs.String("id", "", "field ID")
	specPath := fs.String("spec", "examples/local.json", "field spec for create")
	domain := fs.String("domain", "", "memory domain for get/put")
	memoryKey := fs.String("key", "", "memory key for get/put")
	value := fs.String("value", "", "memory string for put")
	units := fs.Int("units", 0, "new logical unit count for resize")
	workloadName := fs.String("workload", "", "registered workload name for invoke")
	inputFile := fs.String("input-file", "", "UTF-8 text file for invoke (default empty stdin payload)")
	saveDomain := fs.String("save-domain", "", "optional snapshot domain for invoke result")
	saveKey := fs.String("save-key", "", "optional snapshot key for invoke result")
	if err := fs.Parse(args[1:]); err != nil {
		return err
	}
	token, err := readToken(*tokenPath)
	if err != nil {
		return err
	}
	u, err := url.Parse(*endpoint)
	if err != nil {
		return err
	}
	if u.Scheme != "http" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" || u.Hostname() == "" {
		return errors.New("control URL must be a loopback http://IP:port with no path, query, or credentials")
	}
	if err := control.ValidateListen(u.Host); err != nil {
		return err
	}
	var method, path string
	var body []byte
	switch action {
	case "status":
		method = http.MethodGet
		path = "/v1/status"
	case "workloads":
		method = http.MethodGet
		path = "/v1/workloads"
	case "create":
		s, err := readSpec(*specPath)
		if err != nil {
			return err
		}
		body, err = json.Marshal(s)
		if err != nil {
			return err
		}
		method = http.MethodPost
		path = "/v1/fields"
	case "list":
		method = http.MethodGet
		path = "/v1/fields"
	case "inspect", "run", "resize", "invoke", "get", "put":
		if !safeCLIIdentifier(*id) {
			return errors.New("-id must be a safe field identifier")
		}
		path = "/v1/fields/" + *id
		switch action {
		case "inspect":
			method = http.MethodGet
		case "resize":
			method = http.MethodPut
			path += "/resize"
			body, _ = json.Marshal(map[string]int{"unit_count": *units})
		case "invoke":
			if !safeCLIIdentifier(*workloadName) {
				return errors.New("-workload must be a safe registered name")
			}
			if (*saveDomain == "") != (*saveKey == "") {
				return errors.New("-save-domain and -save-key must be supplied together")
			}
			if *saveDomain != "" && (!safeCLIIdentifier(*saveDomain) || !safeCLIIdentifier(*saveKey)) {
				return errors.New("invalid snapshot domain or key")
			}
			input := ""
			if *inputFile != "" {
				file, err := os.Open(*inputFile)
				if err != nil {
					return err
				}
				b, readErr := io.ReadAll(io.LimitReader(file, workload.MaxInputBytes+1))
				file.Close()
				if readErr != nil {
					return readErr
				}
				if len(b) > workload.MaxInputBytes {
					return errors.New("invoke input file >64KiB")
				}
				input = string(b)
			}
			method = http.MethodPost
			path += "/invoke/" + *workloadName
			body, _ = json.Marshal(map[string]string{"input": input, "save_domain": *saveDomain, "save_key": *saveKey})
		case "run":
			method = http.MethodPost
			path += "/run"
		case "get", "put":
			if !safeCLIIdentifier(*domain) || !safeCLIIdentifier(*memoryKey) {
				return errors.New("-domain and -key require safe ASCII identifiers")
			}
			path += "/memory/" + *domain + "/" + *memoryKey
			if action == "get" {
				method = http.MethodGet
			} else {
				method = http.MethodPut
				body, _ = json.Marshal(map[string]string{"value": *value})
			}
		}
	default:
		return fmt.Errorf("unknown ctl action %q", action)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 70*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, method, u.String()+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if method == http.MethodPost && (action == "create" || action == "invoke") || method == http.MethodPut {
		req.Header.Set("Content-Type", "application/json")
	}
	client := &http.Client{Timeout: 70 * time.Second, Transport: &http.Transport{Proxy: nil}, CheckRedirect: func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	answer, err := io.ReadAll(io.LimitReader(res.Body, 2*1024*1024))
	if err != nil {
		return err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("control returned HTTP %d: %s", res.StatusCode, strings.TrimSpace(string(answer)))
	}
	if len(answer) > 0 {
		_, err = os.Stdout.Write(answer)
		return err
	}
	return emit(map[string]string{"status": "ok"})
}

func safeCLIIdentifier(s string) bool {
	if s == "" || s == "." || s == ".." || len(s) > 96 {
		return false
	}
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' || r == '.' {
			continue
		}
		return false
	}
	return true
}
