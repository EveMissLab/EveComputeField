// Package authority provides a single-process, local-first authority for durable
// field identities. It does not implement multi-node consensus or distributed RAM.
package authority

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/EveMissLab/EveComputeField/internal/field"
)

var (
	ErrExists    = errors.New("field already exists")
	ErrNotFound  = errors.New("field not found")
	ErrInvalid   = errors.New("invalid field operation")
	ErrExecution = errors.New("field execution failed")
)

const maxSpecBytes = 1024 * 1024
const maxSnapshotBytes = 80 * 1024 * 1024

type View struct {
	FieldID      string             `json:"field_id"`
	SpecDigest   string             `json:"spec_digest"`
	LogicalUnits int                `json:"logical_units"`
	Epoch        uint64             `json:"epoch"`
	Results      map[string]float64 `json:"results"`
	Status       string             `json:"status"`
}

type entry struct {
	mu      sync.Mutex
	spec    field.Spec
	state   *field.State
	blocked bool // a pending failed resize requires service restart/recovery
}

type Manager struct {
	mu       sync.RWMutex
	root     string
	fields   map[string]*entry
	execs    map[string]field.Executor
	parallel int
}

func Open(root string, backends map[string]field.Executor, parallel int) (*Manager, error) {
	if parallel < 1 || parallel > 1024 {
		return nil, errors.New("parallel must be 1..1024")
	}
	if backends["local"] == nil {
		return nil, errors.New("a local reference backend is required")
	}
	path, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(path, 0700); err != nil {
		return nil, err
	}
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("field root must be an ordinary directory")
	}
	if err := os.Chmod(path, 0700); err != nil {
		return nil, err
	}
	m := &Manager{root: path, fields: make(map[string]*entry), execs: make(map[string]field.Executor), parallel: parallel}
	for name, exec := range backends {
		if exec == nil {
			return nil, fmt.Errorf("nil executor %q", name)
		}
		m.execs[name] = exec
	}
	items, err := os.ReadDir(path)
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		if strings.HasPrefix(item.Name(), ".new-field-") {
			continue
		} // incomplete creation cannot be authoritative
		if item.Type()&os.ModeSymlink != 0 {
			return nil, fmt.Errorf("entry %q is a symlink", item.Name())
		}
		if !item.IsDir() {
			continue
		}
		directory := filepath.Join(path, item.Name())
		if err := recoverResize(directory); err != nil {
			return nil, fmt.Errorf("recover resize for %q: %w", item.Name(), err)
		}
		if item.Type()&os.ModeSymlink != 0 {
			return nil, fmt.Errorf("field directory %q is a symlink", item.Name())
		}
		specBytes, err := readBounded(filepath.Join(directory, "spec.json"), maxSpecBytes)
		if err != nil {
			return nil, fmt.Errorf("load field %q spec: %w", item.Name(), err)
		}
		spec, err := field.ParseJSON(specBytes)
		if err != nil {
			return nil, fmt.Errorf("load field %q spec: %w", item.Name(), err)
		}
		if spec.FieldID != item.Name() {
			return nil, fmt.Errorf("field directory %q does not match its identity", item.Name())
		}
		snapshotPath := filepath.Join(directory, "state.json")
		if err := checkRegular(snapshotPath); err != nil {
			return nil, fmt.Errorf("field %q snapshot: %w", item.Name(), err)
		}
		stat, err := os.Stat(snapshotPath)
		if err != nil {
			return nil, err
		}
		if stat.Size() > maxSnapshotBytes {
			return nil, fmt.Errorf("field %q snapshot too large", item.Name())
		}
		state, err := field.LoadState(spec, snapshotPath)
		if err != nil {
			return nil, fmt.Errorf("field %q snapshot: %w", item.Name(), err)
		}
		m.fields[spec.FieldID] = &entry{spec: spec, state: state}
	}
	return m, nil
}

func checkRegular(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return errors.New("not a regular file")
	}
	return nil
}

func readBounded(path string, max int64) ([]byte, error) {
	if err := checkRegular(path); err != nil {
		return nil, err
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, max+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > max {
		return nil, errors.New("file exceeds maximum size")
	}
	return data, nil
}

func writeNew(path string, data []byte) error {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

func (m *Manager) Root() string { return m.root }

func (m *Manager) Create(spec field.Spec) (View, error) {
	if err := spec.Validate(); err != nil {
		return View{}, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, exists := m.fields[spec.FieldID]; exists {
		return View{}, ErrExists
	}
	dst := filepath.Join(m.root, spec.FieldID)
	if _, err := os.Lstat(dst); err == nil {
		return View{}, ErrExists
	} else if !errors.Is(err, os.ErrNotExist) {
		return View{}, err
	}
	stage, err := os.MkdirTemp(m.root, ".new-field-")
	if err != nil {
		return View{}, err
	}
	defer os.RemoveAll(stage)
	if err := os.Chmod(stage, 0700); err != nil {
		return View{}, err
	}
	raw, err := json.MarshalIndent(spec, "", "  ")
	if err != nil {
		return View{}, err
	}
	if len(raw) > maxSpecBytes {
		return View{}, errors.New("spec exceeds maximum serialized size")
	}
	if err := writeNew(filepath.Join(stage, "spec.json"), raw); err != nil {
		return View{}, err
	}
	state, err := field.NewState(spec)
	if err != nil {
		return View{}, err
	}
	if err := state.Save(spec, filepath.Join(stage, "state.json")); err != nil {
		return View{}, err
	}
	if err := os.Rename(stage, dst); err != nil {
		return View{}, err
	}
	e := &entry{spec: spec, state: state}
	m.fields[spec.FieldID] = e
	return viewOf(e), nil
}

func viewOf(e *entry) View {
	result := make(map[string]float64, len(e.state.Results))
	for k, v := range e.state.Results {
		result[k] = v
	}
	status := "ready"
	if e.blocked {
		status = "needs-recovery"
	}
	return View{FieldID: e.spec.FieldID, SpecDigest: e.spec.Digest(), LogicalUnits: e.spec.UnitCount, Epoch: e.state.Epoch, Results: result, Status: status}
}

func (m *Manager) entry(id string) (*entry, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	e, ok := m.fields[id]
	if !ok {
		return nil, ErrNotFound
	}
	return e, nil
}

func (m *Manager) Inspect(id string) (View, error) {
	e, err := m.entry(id)
	if err != nil {
		return View{}, err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	return viewOf(e), nil
}

func (m *Manager) List() []View {
	m.mu.RLock()
	names := make([]string, 0, len(m.fields))
	for id := range m.fields {
		names = append(names, id)
	}
	sort.Strings(names)
	entries := make([]*entry, 0, len(names))
	for _, id := range names {
		entries = append(entries, m.fields[id])
	}
	m.mu.RUnlock()
	views := make([]View, 0, len(entries))
	for _, e := range entries {
		e.mu.Lock()
		views = append(views, viewOf(e))
		e.mu.Unlock()
	}
	return views
}

// Run serializes updates per field and checkpoints to disk BEFORE publishing
// the new in-memory epoch. Inflight remote pure tasks may finish after a failed
// run, but cannot commit an authoritative field transition.
func (m *Manager) Run(ctx context.Context, id string) (field.Report, error) {
	e, err := m.entry(id)
	if err != nil {
		return field.Report{}, err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.blocked {
		return field.Report{}, errors.New("field needs recovery: restart authority")
	}
	candidate := *e.state
	report, err := field.ExecuteRun(ctx, e.spec, &candidate, m.execs, m.parallel)
	if err != nil {
		return field.Report{}, fmt.Errorf("%w: %v", ErrExecution, err)
	}
	if err := ctx.Err(); err != nil {
		return field.Report{}, err
	}
	if err := candidate.Save(e.spec, filepath.Join(m.root, id, "state.json")); err != nil {
		return field.Report{}, err
	}
	e.state = &candidate
	return report, nil
}

func cloneData(in map[string]map[string]string) map[string]map[string]string {
	out := make(map[string]map[string]string, len(in))
	for domain, values := range in {
		next := make(map[string]string, len(values))
		for key, value := range values {
			next[key] = value
		}
		out[domain] = next
	}
	return out
}

func (m *Manager) Put(id, domain, key, value string) error {
	e, err := m.entry(id)
	if err != nil {
		return err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.blocked {
		return errors.New("field needs recovery: restart authority")
	}
	candidate := *e.state
	candidate.Data = cloneData(e.state.Data)
	if err := candidate.Put(e.spec, domain, key, value); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	if err := candidate.Save(e.spec, filepath.Join(m.root, id, "state.json")); err != nil {
		return err
	}
	e.state = &candidate
	return nil
}

func (m *Manager) Get(id, domain, key string) (string, bool, error) {
	e, err := m.entry(id)
	if err != nil {
		return "", false, err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.blocked {
		return "", false, errors.New("field needs recovery: restart authority")
	}
	value, ok, err := e.state.Get(e.spec, domain, key)
	if err != nil {
		return "", false, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	return value, ok, nil
}
