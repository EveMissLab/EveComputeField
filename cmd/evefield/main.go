package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/EveMissLab/EveComputeField/internal/devcert"
	"github.com/EveMissLab/EveComputeField/internal/field"
	"github.com/EveMissLab/EveComputeField/internal/transport"
)

func usage() {
	fmt.Fprintln(os.Stderr, `EveComputeField reference CLI
Commands:
  token  -out ./control.token
  serve  -data ./field-data -token-file ./control.token [-listen 127.0.0.1:8765] [-workloads REGISTRY.json]
  ctl    create -spec examples/local.json [-token-file ./control.token]
  ctl    status | list | workloads | inspect -id FIELD | run -id FIELD
  ctl    resize -id FIELD -units 720
  ctl    invoke -id FIELD -workload NAME [-input-file PATH] [-save-domain DOMAIN -save-key KEY]
  ctl    get/put -id FIELD -domain DOMAIN -key KEY
  tool   sha256 | uppercase | lines | fluid (trusted local standard-input workload helpers)
  plan   -spec examples/local.json
  run    -spec examples/local.json [-state ./field-state.json] [-parallel 4]
  certs  -out ./dev-certs [-host 127.0.0.1]
  worker -listen 127.0.0.1:8443 -ca CA -cert WORKER_CERT -key WORKER_KEY
  run    -spec examples/lan.json -remote worker=https://127.0.0.1:8443 -ca CA -cert CLIENT_CERT -key CLIENT_KEY

Worker transport is TLS 1.3 with required client certificates; no unauthenticated LAN mode.
The DAG reference backend implements pure sum/mul operations; opt-in named
workloads enable trusted local programs, but are NOT sandboxed or transactional.`)
}

type remoteFlags []string

func (r *remoteFlags) String() string     { return strings.Join(*r, ",") }
func (r *remoteFlags) Set(s string) error { *r = append(*r, s); return nil }

func readSpec(path string) (field.Spec, error) {
	f, err := os.Open(path)
	if err != nil {
		return field.Spec{}, err
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, 1024*1024+1))
	if err != nil {
		return field.Spec{}, err
	}
	if len(b) > 1024*1024 {
		return field.Spec{}, errors.New("spec file exceeds 1MiB")
	}
	return field.ParseJSON(b)
}
func emit(v any) error { return json.NewEncoder(os.Stdout).Encode(v) }

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "ERROR:", err)
		os.Exit(1)
	}
}
func run(args []string) error {
	if len(args) < 1 {
		usage()
		return errors.New("missing command")
	}
	switch args[0] {
	case "token":
		return tokenCommand(args[1:])
	case "tool":
		return toolCommand(args[1:])
	case "serve":
		return serveCommand(args[1:])
	case "ctl":
		return ctlCommand(args[1:])
	case "plan":
		fs := flag.NewFlagSet("plan", flag.ContinueOnError)
		specFile := fs.String("spec", "examples/local.json", "field spec JSON")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		spec, err := readSpec(*specFile)
		if err != nil {
			return err
		}
		layers, err := spec.Layers()
		if err != nil {
			return err
		}
		names := make([][]string, len(layers))
		for i, ts := range layers {
			for _, t := range ts {
				names[i] = append(names[i], t.ID)
			}
		}
		return emit(map[string]any{"version": field.ProtocolVersion, "field_id": spec.FieldID, "logical_units": spec.UnitCount, "spec_digest": spec.Digest(), "layers": names})
	case "run":
		fs := flag.NewFlagSet("run", flag.ContinueOnError)
		specFile := fs.String("spec", "examples/local.json", "field spec JSON")
		stateFile := fs.String("state", "", "optional persistent snapshot path")
		parallel := fs.Int("parallel", 4, "max simultaneous tasks within a DAG layer")
		ca := fs.String("ca", "", "root CA for workers")
		cert := fs.String("cert", "", "mutual TLS client certificate")
		key := fs.String("key", "", "mutual TLS client key")
		var remotes remoteFlags
		fs.Var(&remotes, "remote", "repeated: node=https://host:8443")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		spec, err := readSpec(*specFile)
		if err != nil {
			return err
		}
		state, err := field.NewState(spec)
		if err != nil {
			return err
		}
		if *stateFile != "" {
			if _, statErr := os.Stat(*stateFile); statErr == nil {
				state, err = field.LoadState(spec, *stateFile)
				if err != nil {
					return err
				}
			} else if !errors.Is(statErr, os.ErrNotExist) {
				return statErr
			}
		}
		backends := map[string]field.Executor{"local": field.LocalExecutor{}}
		for _, remote := range remotes {
			parts := strings.SplitN(remote, "=", 2)
			if len(parts) != 2 || parts[0] == "" || parts[0] == "local" {
				return fmt.Errorf("bad remote mapping %q", remote)
			}
			if *ca == "" || *cert == "" || *key == "" {
				return errors.New("remote workers require -ca, -cert, and -key")
			}
			if _, exists := backends[parts[0]]; exists {
				return errors.New("duplicate remote alias")
			}
			backend, err := transport.NewRemoteExecutor(strings.TrimRight(parts[1], "/"), *ca, *cert, *key)
			if err != nil {
				return err
			}
			backends[parts[0]] = backend
		}
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		report, err := field.ExecuteRun(ctx, spec, state, backends, *parallel)
		if err != nil {
			return err
		}
		if *stateFile != "" {
			if err := state.Save(spec, *stateFile); err != nil {
				return err
			}
		}
		return emit(report)
	case "worker":
		fs := flag.NewFlagSet("worker", flag.ContinueOnError)
		listen := fs.String("listen", "127.0.0.1:8443", "bind IP:port; explicit LAN IP for LAN")
		ca := fs.String("ca", "", "CA cert for required client verification")
		cert := fs.String("cert", "", "worker TLS server cert")
		key := fs.String("key", "", "worker TLS private key")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		if *ca == "" || *cert == "" || *key == "" {
			return errors.New("worker requires -ca, -cert, -key")
		}
		tlsConfig, err := transport.ServerTLSConfig(*ca, *cert, *key)
		if err != nil {
			return err
		}
		server := http.Server{Addr: *listen, Handler: transport.WorkerHandler(), TLSConfig: tlsConfig,
			ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 15 * time.Second,
		}
		log.Printf("EveComputeField mTLS worker on %s (allowlisted operations only)", *listen)
		return server.ListenAndServeTLS("", "")
	case "certs":
		fs := flag.NewFlagSet("certs", flag.ContinueOnError)
		out := fs.String("out", "./dev-certs", "development-only credentials output")
		host := fs.String("host", "127.0.0.1", "worker server hostname or IP SAN")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		if err := devcert.Generate(*out, *host); err != nil {
			return err
		}
		return emit(map[string]string{"status": "DEVELOPMENT ONLY: keys generated; NEVER COMMIT", "directory": *out, "expires": "7 days after generation"})
	default:
		usage()
		return fmt.Errorf("unknown command %q", args[0])
	}
}
