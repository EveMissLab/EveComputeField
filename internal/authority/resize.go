package authority

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/EveMissLab/EveComputeField/internal/field"
)

const resizeJournalName = ".resize.pending.json"

// A durable intent is replayed forward after interruption between spec and
// state replacement. This is a local recovery protocol, not a filesystem or
// hardware transaction. A corrupted journal fails closed for manual recovery.
type resizeIntent struct {
	Version string      `json:"version"`
	Spec    field.Spec  `json:"spec"`
	State   field.State `json:"state"`
}

func newResizeIntent(spec field.Spec, state *field.State) (resizeIntent, error) {
	if err := spec.Validate(); err != nil {
		return resizeIntent{}, err
	}
	if state.FieldID != spec.FieldID || state.SpecDigest != spec.Digest() {
		return resizeIntent{}, errors.New("resize intent state/spec mismatch")
	}
	cp := *state
	cp.Results = make(map[string]float64, len(state.Results))
	for id, v := range state.Results {
		cp.Results[id] = v
	}
	cp.Data = make(map[string]map[string]string)
	for _, d := range spec.Domains {
		if d.Kind != "snapshot" {
			continue
		}
		values := make(map[string]string)
		for k, v := range state.Data[d.ID] {
			values[k] = v
		}
		cp.Data[d.ID] = values
	}
	return resizeIntent{Version: "resize-intent/v1", Spec: spec, State: cp}, nil
}

func validateIntent(in resizeIntent) error {
	if in.Version != "resize-intent/v1" {
		return errors.New("unknown resize journal version")
	}
	if err := in.Spec.Validate(); err != nil {
		return err
	}
	if in.State.Version != field.ProtocolVersion || in.State.FieldID != in.Spec.FieldID || in.State.SpecDigest != in.Spec.Digest() {
		return errors.New("resize intent has inconsistent identity")
	}
	for _, d := range in.Spec.Domains {
		if d.Kind != "snapshot" {
			if len(in.State.Data[d.ID]) > 0 {
				return errors.New("volatile memory found in persistent resize intent")
			}
			continue
		}
		total := 0
		for k, v := range in.State.Data[d.ID] {
			total += len(k) + len(v)
		}
		if total > d.QuotaBytes {
			return errors.New("resize intent memory quota exceeded")
		}
	}
	for key := range in.State.Data {
		found := false
		for _, d := range in.Spec.Domains {
			if d.ID == key && d.Kind == "snapshot" {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("unknown snapshot domain %q", key)
		}
	}
	return nil
}

// writeReplace writes a single complete file by rename within the same directory.
func writeReplace(path string, data []byte) error {
	dir := filepath.Dir(path)
	f, err := os.CreateTemp(dir, ".m2-replace-*")
	if err != nil {
		return err
	}
	tempName := f.Name()
	defer os.Remove(tempName)
	if err := f.Chmod(0600); err != nil {
		f.Close()
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
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tempName, path)
}

func replayResize(directory string, intent resizeIntent) error {
	if err := validateIntent(intent); err != nil {
		return err
	}
	specBytes, err := json.MarshalIndent(intent.Spec, "", "  ")
	if err != nil {
		return err
	}
	if err := writeReplace(filepath.Join(directory, "spec.json"), specBytes); err != nil {
		return err
	}
	if err := intent.State.Save(intent.Spec, filepath.Join(directory, "state.json")); err != nil {
		return err
	}
	return os.Remove(filepath.Join(directory, resizeJournalName))
}

func recoverResize(directory string) error {
	path := filepath.Join(directory, resizeJournalName)
	if _, err := os.Lstat(path); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	data, err := readBounded(path, maxSnapshotBytes)
	if err != nil {
		return err
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	var in resizeIntent
	if err := dec.Decode(&in); err != nil {
		return err
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		return errors.New("trailing resize journal data")
	}
	if in.Spec.FieldID != filepath.Base(directory) {
		return errors.New("resize journal field identity mismatch")
	}
	return replayResize(directory, in)
}

// Resize changes logical-unit count in a quiescent field. Existing numeric
// results, field identity, epoch and memory domains remain unchanged. The unit
// count is NOT a count of physical CPU cores or goroutines.
func (m *Manager) Resize(id string, count int) (View, error) {
	e, err := m.entry(id)
	if err != nil {
		return View{}, err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.blocked {
		return View{}, errors.New("field needs recovery: restart authority")
	}
	if count == e.spec.UnitCount {
		return viewOf(e), nil
	}
	candidate := *e.state
	next, err := candidate.Reconfigure(e.spec, count)
	if err != nil {
		return View{}, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	in, err := newResizeIntent(next, &candidate)
	if err != nil {
		return View{}, err
	}
	data, err := json.Marshal(in)
	if err != nil {
		return View{}, err
	}
	if len(data) > maxSnapshotBytes {
		return View{}, errors.New("resize journal exceeds size guardrail")
	}
	dir := filepath.Join(m.root, id)
	journal := filepath.Join(dir, resizeJournalName)
	if err := writeNew(journal, data); err != nil {
		return View{}, err
	}
	// Once intent exists, any failure requires restarting for journal replay.
	if err := replayResize(dir, in); err != nil {
		e.blocked = true
		return View{}, fmt.Errorf("resize needs restart/recovery: %w", err)
	}
	e.spec = next
	e.state = &candidate
	return viewOf(e), nil
}
