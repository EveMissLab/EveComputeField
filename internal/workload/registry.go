// Package workload provides an opt-in local process adapter. It is NOT a
// sandbox. Only pre-registered executable paths and constant arguments are
// accepted; HTTP clients cannot submit command names, paths or shell scripts.
package workload

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

var (
	ErrUnknown     = errors.New("unknown workload")
	ErrExecution   = errors.New("workload process failed")
	ErrOutputLimit = errors.New("workload output exceeded limit")
)

const MaxInputBytes = 64 * 1024
const MaxConfigBytes = 64 * 1024
const MaxOutputBytes = 256 * 1024

type Definition struct {
	Name           string   `json:"name"`
	Program        string   `json:"program"`
	Args           []string `json:"args,omitempty"`
	TimeoutMS      int      `json:"timeout_ms"`
	MaxOutputBytes int      `json:"max_output_bytes"`
	WorkDir        string   `json:"work_dir,omitempty"`
}

type File struct {
	Workloads []Definition `json:"workloads"`
}

type Registry struct {
	definitions map[string]Definition
	slots       chan struct{}
}

type Result struct {
	Workload   string `json:"workload"`
	Stdout     string `json:"stdout"`
	Stderr     string `json:"stderr"`
	ExitCode   int    `json:"exit_code"`
	DurationMS int64  `json:"duration_ms"`
	Saved      bool   `json:"saved"`
}

func safeName(name string) bool {
	if len(name) < 1 || len(name) > 64 {
		return false
	}
	for _, c := range name {
		if c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_' {
			continue
		}
		return false
	}
	return true
}

func validate(d Definition) error {
	if !safeName(d.Name) {
		return errors.New("workload name must be 1..64 safe ASCII characters")
	}
	if !filepath.IsAbs(d.Program) {
		return errors.New("workload program must be an absolute path")
	}
	info, err := os.Lstat(d.Program)
	if err != nil {
		return fmt.Errorf("workload executable: %w", err)
	}
	if !info.Mode().IsRegular() {
		return errors.New("workload executable must be a regular file (no symlink)")
	}
	if d.TimeoutMS < 100 || d.TimeoutMS > 60000 {
		return errors.New("workload timeout_ms must be 100..60000")
	}
	if d.MaxOutputBytes < 1 || d.MaxOutputBytes > MaxOutputBytes {
		return errors.New("workload max_output_bytes outside limit")
	}
	if len(d.Args) > 40 {
		return errors.New("too many fixed arguments")
	}
	total := 0
	for _, a := range d.Args {
		total += len(a)
		if len(a) > 4096 || strings.ContainsRune(a, '\x00') {
			return errors.New("unsafe or oversized fixed argument")
		}
	}
	if total > 32768 {
		return errors.New("fixed arguments too large")
	}
	if d.WorkDir != "" {
		if !filepath.IsAbs(d.WorkDir) {
			return errors.New("work_dir must be an absolute path")
		}
		dir, err := os.Lstat(d.WorkDir)
		if err != nil {
			return err
		}
		if !dir.IsDir() || dir.Mode()&os.ModeSymlink != 0 {
			return errors.New("work_dir must be an ordinary directory")
		}
	}
	return nil
}

func New(defs []Definition, maxConcurrent int) (*Registry, error) {
	if maxConcurrent < 1 || maxConcurrent > 32 {
		return nil, errors.New("workload parallelism must be 1..32")
	}
	r := &Registry{definitions: make(map[string]Definition), slots: make(chan struct{}, maxConcurrent)}
	for _, d := range defs {
		if err := validate(d); err != nil {
			return nil, fmt.Errorf("%s: %w", d.Name, err)
		}
		if _, exists := r.definitions[d.Name]; exists {
			return nil, fmt.Errorf("duplicate workload %q", d.Name)
		}
		r.definitions[d.Name] = d
	}
	return r, nil
}

func (r *Registry) Names() []string {
	if r == nil {
		return nil
	}
	names := make([]string, 0, len(r.definitions))
	for k := range r.definitions {
		names = append(names, k)
	}
	sort.Strings(names)
	return names
}

func Load(path string, maxConcurrent int) (*Registry, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > MaxConfigBytes {
		return nil, errors.New("workload registry must be a regular file <= 64KiB")
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, MaxConfigBytes+1))
	if err != nil || len(raw) > MaxConfigBytes {
		return nil, errors.New("workload registry too large")
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var file File
	if err := dec.Decode(&file); err != nil {
		return nil, err
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		return nil, errors.New("trailing registry content")
	}
	return New(file.Workloads, maxConcurrent)
}

type capWriter struct {
	buf   bytes.Buffer
	limit int
}

func (w *capWriter) Write(p []byte) (int, error) {
	if len(p) > w.limit-w.buf.Len() {
		return 0, ErrOutputLimit
	}
	return w.buf.Write(p)
}

func minimalEnv() []string {
	// Do not leak user API keys or secrets from the parent environment by default.
	allow := []string{"PATH", "HOME", "LANG", "LC_ALL", "USERPROFILE", "SystemRoot", "WINDIR", "TEMP", "TMP"}
	vars := make([]string, 0, len(allow))
	for _, k := range allow {
		if v, ok := os.LookupEnv(k); ok {
			vars = append(vars, k+"="+v)
		}
	}
	return vars
}

func (r *Registry) Run(ctx context.Context, name, input string) (Result, error) {
	if r == nil {
		return Result{}, ErrUnknown
	}
	def, ok := r.definitions[name]
	if !ok {
		return Result{}, ErrUnknown
	}
	if len(input) > MaxInputBytes {
		return Result{}, errors.New("workload input >64KiB")
	}
	started := time.Now()
	ctx, cancel := context.WithTimeout(ctx, time.Duration(def.TimeoutMS)*time.Millisecond)
	defer cancel()
	select {
	case r.slots <- struct{}{}:
		defer func() { <-r.slots }()
	case <-ctx.Done():
		return Result{}, ctx.Err()
	}
	cmd := exec.CommandContext(ctx, def.Program, def.Args...)
	cmd.Env = minimalEnv()
	cmd.Stdin = strings.NewReader(input)
	cmd.WaitDelay = 200 * time.Millisecond
	if def.WorkDir != "" {
		cmd.Dir = def.WorkDir
	} else {
		cmd.Dir = filepath.Dir(def.Program)
	}
	stdout := &capWriter{limit: def.MaxOutputBytes}
	stderr := &capWriter{limit: def.MaxOutputBytes}
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	err := cmd.Run()
	res := Result{Workload: name, Stdout: stdout.buf.String(), Stderr: stderr.buf.String(), ExitCode: 0, DurationMS: time.Since(started).Milliseconds()}
	if ctx.Err() != nil {
		return res, ctx.Err()
	}
	if err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			res.ExitCode = exit.ExitCode()
		}
		if errors.Is(err, ErrOutputLimit) {
			return res, ErrOutputLimit
		}
		return res, fmt.Errorf("%w: %v", ErrExecution, err)
	}
	if !utf8.ValidString(res.Stdout) || !utf8.ValidString(res.Stderr) {
		return res, fmt.Errorf("%w: non-UTF-8 output", ErrExecution)
	}
	return res, nil
}
