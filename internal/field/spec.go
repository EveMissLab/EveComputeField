package field

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"sort"
	"strings"
)

// ProtocolVersion is a schema protocol, not a Go implementation version.
const ProtocolVersion = "field/v0.1"
const MaxLogicalUnits = 65536 // Reference guardrail, not an inherent architectural limit.

type MemoryDomain struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"` // volatile or snapshot; NOT an OS address space / mmap yet.
	QuotaBytes int    `json:"quota_bytes"`
}

type Task struct {
	ID        string    `json:"id"`
	Op        string    `json:"op"` // The reference backend only permits sum and mul.
	Inputs    []float64 `json:"inputs,omitempty"`
	DependsOn []string  `json:"depends_on,omitempty"`
	Node      string    `json:"node,omitempty"` // Empty or local executes in the coordinator.
}

type Spec struct {
	Version   string         `json:"version"`
	FieldID   string         `json:"field_id"`
	UnitCount int            `json:"unit_count"`
	Domains   []MemoryDomain `json:"memory_domains"`
	Tasks     []Task         `json:"tasks"`
}

func safeID(s string) bool {
	if s == "" || len(s) > 96 {
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

func (s Spec) Validate() error {
	if s.Version != ProtocolVersion {
		return fmt.Errorf("unsupported spec version %q", s.Version)
	}
	if !safeID(s.FieldID) {
		return errors.New("field_id must be 1..96 ASCII letters/digits/dash/underscore/dot")
	}
	if s.UnitCount < 1 || s.UnitCount > MaxLogicalUnits {
		return fmt.Errorf("unit_count outside reference range 1..%d", MaxLogicalUnits)
	}
	domains := make(map[string]bool)
	for _, d := range s.Domains {
		if !safeID(d.ID) || domains[d.ID] {
			return fmt.Errorf("invalid or duplicate domain %q", d.ID)
		}
		domains[d.ID] = true
		if d.Kind != "volatile" && d.Kind != "snapshot" {
			return fmt.Errorf("domain %q kind must be volatile or snapshot", d.ID)
		}
		if d.QuotaBytes <= 0 || d.QuotaBytes > 64*1024*1024 {
			return fmt.Errorf("domain %q quota must be 1..64MiB in reference implementation", d.ID)
		}
	}
	ids := make(map[string]bool)
	for _, t := range s.Tasks {
		if !safeID(t.ID) || ids[t.ID] {
			return fmt.Errorf("invalid or duplicate task %q", t.ID)
		}
		ids[t.ID] = true
		if t.Op != "sum" && t.Op != "mul" {
			return fmt.Errorf("task %q has disallowed operation %q", t.ID, t.Op)
		}
		if t.Node != "" && t.Node != "local" && !safeID(t.Node) {
			return fmt.Errorf("invalid node %q", t.Node)
		}
		for _, v := range t.Inputs {
			if math.IsNaN(v) || math.IsInf(v, 0) {
				return fmt.Errorf("non-finite task input for %q", t.ID)
			}
		}
	}
	for _, t := range s.Tasks {
		deps := make(map[string]bool)
		for _, dep := range t.DependsOn {
			if !ids[dep] {
				return fmt.Errorf("task %q depends on unknown task %q", t.ID, dep)
			}
			if dep == t.ID || deps[dep] {
				return fmt.Errorf("self-dependency or duplicate dependency for task %q", t.ID)
			}
			deps[dep] = true
		}
	}
	_, err := s.Layers()
	return err
}

// Layers yields deterministic topological commit barriers. Execution within a layer may be parallel.
func (s Spec) Layers() ([][]Task, error) {
	ids := make(map[string]Task, len(s.Tasks))
	pending := make(map[string]int, len(s.Tasks))
	downstream := make(map[string][]string)
	for _, t := range s.Tasks {
		if _, dup := ids[t.ID]; dup {
			return nil, fmt.Errorf("duplicate task id %q", t.ID)
		}
		ids[t.ID] = t
		pending[t.ID] = len(t.DependsOn)
		for _, d := range t.DependsOn {
			downstream[d] = append(downstream[d], t.ID)
		}
	}
	layers := make([][]Task, 0)
	used := make(map[string]bool)
	for len(used) < len(ids) {
		names := make([]string, 0)
		for id, count := range pending {
			if !used[id] && count == 0 {
				names = append(names, id)
			}
		}
		if len(names) == 0 {
			return nil, errors.New("cyclic or missing DAG dependency")
		}
		sort.Strings(names)
		layer := make([]Task, 0, len(names))
		for _, id := range names {
			layer = append(layer, ids[id])
			used[id] = true
		}
		layers = append(layers, layer)
		for _, id := range names {
			for _, consumer := range downstream[id] {
				pending[consumer]--
			}
		}
	}
	return layers, nil
}

func (s Spec) Digest() string {
	data, _ := json.Marshal(s)
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func (s Spec) UnitID(index int) (string, error) {
	if index < 0 || index >= s.UnitCount {
		return "", fmt.Errorf("logical unit index out of range")
	}
	return fmt.Sprintf("%s/unit/%06d", s.FieldID, index), nil
}

func (s Spec) Resize(count int) (Spec, error) {
	out := s
	out.UnitCount = count
	if err := out.Validate(); err != nil {
		return s, err
	}
	return out, nil
}

func ParseJSON(b []byte) (Spec, error) {
	var s Spec
	dec := json.NewDecoder(strings.NewReader(string(b)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&s); err != nil {
		return Spec{}, err
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		return Spec{}, errors.New("trailing JSON data")
	}
	if err := s.Validate(); err != nil {
		return Spec{}, err
	}
	return s, nil
}
