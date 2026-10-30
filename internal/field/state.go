package field

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// State is local authority state. Snapshot domains are serialized into the state file;
// volatile domains intentionally disappear on process restore.
type State struct {
	Version    string                       `json:"version"`
	FieldID    string                       `json:"field_id"`
	SpecDigest string                       `json:"spec_digest"`
	Epoch      uint64                       `json:"epoch"`
	Results    map[string]float64           `json:"results"`
	Data       map[string]map[string]string `json:"data"`
}

func NewState(spec Spec) (*State, error) {
	if err := spec.Validate(); err != nil {
		return nil, err
	}
	return &State{Version: ProtocolVersion, FieldID: spec.FieldID, SpecDigest: spec.Digest(), Results: map[string]float64{}, Data: map[string]map[string]string{}}, nil
}

func domain(spec Spec, id string) (MemoryDomain, bool) {
	for _, d := range spec.Domains {
		if d.ID == id {
			return d, true
		}
	}
	return MemoryDomain{}, false
}

func (s *State) Put(spec Spec, domainID, key, value string) error {
	if s.SpecDigest != spec.Digest() || s.FieldID != spec.FieldID {
		return errors.New("state/spec mismatch")
	}
	d, ok := domain(spec, domainID)
	if !ok {
		return fmt.Errorf("unknown memory domain %q", domainID)
	}
	if key == "" || len(key) > 256 {
		return errors.New("key length must be 1..256 bytes")
	}
	old := s.Data[domainID]
	size := 0
	for k, v := range old {
		if k != key {
			size += len(k) + len(v)
		}
	}
	size += len(key) + len(value)
	if size > d.QuotaBytes {
		return fmt.Errorf("domain %q quota exceeded", domainID)
	}
	if old == nil {
		old = map[string]string{}
		s.Data[domainID] = old
	}
	old[key] = value
	return nil
}

func (s *State) Get(spec Spec, domainID, key string) (string, bool, error) {
	if s.SpecDigest != spec.Digest() || s.FieldID != spec.FieldID {
		return "", false, errors.New("state/spec mismatch")
	}
	if _, ok := domain(spec, domainID); !ok {
		return "", false, fmt.Errorf("unknown memory domain %q", domainID)
	}
	v, ok := s.Data[domainID][key]
	return v, ok, nil
}

// Save writes one complete replacement snapshot (atomic rename on the same filesystem).
// It never serializes volatile domains; this is not durable remote shared memory.
func (s *State) Save(spec Spec, path string) error {
	if s.SpecDigest != spec.Digest() || s.FieldID != spec.FieldID {
		return errors.New("state/spec mismatch")
	}
	cp := *s
	cp.Data = map[string]map[string]string{}
	for _, d := range spec.Domains {
		if d.Kind == "snapshot" {
			inner := map[string]string{}
			for k, v := range s.Data[d.ID] {
				inner[k] = v
			}
			cp.Data[d.ID] = inner
		}
	}
	b, err := json.MarshalIndent(cp, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".field-*.tmp")
	if err != nil {
		return err
	}
	tempName := tmp.Name()
	defer os.Remove(tempName)
	if err := tmp.Chmod(0600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tempName, path)
}

func LoadState(spec Spec, path string) (*State, error) {
	if err := spec.Validate(); err != nil {
		return nil, err
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var s State
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&s); err != nil {
		return nil, err
	}
	if s.Version != ProtocolVersion || s.FieldID != spec.FieldID || s.SpecDigest != spec.Digest() {
		return nil, errors.New("snapshot is from a different spec/version")
	}
	if s.Results == nil {
		s.Results = map[string]float64{}
	}
	if s.Data == nil {
		s.Data = map[string]map[string]string{}
	}
	for id, m := range s.Data {
		d, ok := domain(spec, id)
		if !ok || d.Kind != "snapshot" {
			return nil, fmt.Errorf("snapshot contains illegal domain %q", id)
		}
		n := 0
		for k, v := range m {
			n += len(k) + len(v)
		}
		if n > d.QuotaBytes {
			return nil, fmt.Errorf("snapshot domain %q exceeds quota", id)
		}
	}
	return &s, nil
}

// Reconfigure changes logical unit count while preserving logical IDs 0..min(old,new)-1.
// The field must be quiescent; caller must serialize Run and Reconfigure.
func (s *State) Reconfigure(old Spec, count int) (Spec, error) {
	if s.FieldID != old.FieldID || s.SpecDigest != old.Digest() {
		return old, errors.New("state/spec mismatch")
	}
	newSpec, err := old.Resize(count)
	if err != nil {
		return old, err
	}
	s.SpecDigest = newSpec.Digest()
	return newSpec, nil
}
