package field

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sync"
	"time"
)

type Executor interface {
	Execute(ctx context.Context, op string, inputs []float64) (float64, error)
}

type LocalExecutor struct{}

func (LocalExecutor) Execute(ctx context.Context, op string, inputs []float64) (float64, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	var result float64
	switch op {
	case "sum":
		for _, v := range inputs {
			result += v
		}
	case "mul":
		result = 1
		for _, v := range inputs {
			result *= v
		}
	default:
		return 0, fmt.Errorf("operation %q not allowed", op)
	}
	if math.IsInf(result, 0) || math.IsNaN(result) {
		return 0, errors.New("non-finite computation result")
	}
	return result, nil
}

type Report struct {
	Version        string             `json:"version"`
	FieldID        string             `json:"field_id"`
	Epoch          uint64             `json:"epoch"`
	UnitCount      int                `json:"logical_units"`
	Layers         int                `json:"layers"`
	TaskCount      int                `json:"task_count"`
	Results        map[string]float64 `json:"results"`
	DurationMicros int64              `json:"duration_micros"`
	SpecDigest     string             `json:"spec_digest"`
}

// ExecuteRun uses one local authority. Each layer commits only after every task in the layer succeeds.
// A failed run leaves State unchanged. Remote tasks MUST be pure/idempotent in this reference version.
func ExecuteRun(ctx context.Context, spec Spec, current *State, execs map[string]Executor, parallel int) (Report, error) {
	started := time.Now()
	if err := spec.Validate(); err != nil {
		return Report{}, err
	}
	if current == nil {
		return Report{}, errors.New("nil field state")
	}
	if current.FieldID != spec.FieldID || current.SpecDigest != spec.Digest() {
		return Report{}, errors.New("state and spec mismatch")
	}
	if parallel < 1 || parallel > 1024 {
		return Report{}, errors.New("parallel must be 1..1024")
	}
	layers, _ := spec.Layers()
	results := make(map[string]float64, len(spec.Tasks))
	for _, layer := range layers {
		type result struct {
			id  string
			v   float64
			err error
		}
		jobs := make(chan Task)
		done := make(chan result, len(layer))
		var wg sync.WaitGroup
		threads := parallel
		if len(layer) < threads {
			threads = len(layer)
		}
		for i := 0; i < threads; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for t := range jobs {
					if err := ctx.Err(); err != nil {
						done <- result{t.ID, 0, err}
						continue
					}
					node := t.Node
					if node == "" {
						node = "local"
					}
					backend, ok := execs[node]
					if !ok {
						done <- result{t.ID, 0, fmt.Errorf("unknown backend %q", node)}
						continue
					}
					// Preserve explicit depends_on order; tasks in this layer never depend on one another.
					inputs := append([]float64(nil), t.Inputs...)
					for _, dep := range t.DependsOn {
						inputs = append(inputs, results[dep])
					}
					val, err := backend.Execute(ctx, t.Op, inputs)
					done <- result{t.ID, val, err}
				}
			}()
		}
		for _, task := range layer {
			jobs <- task
		}
		close(jobs)
		wg.Wait()
		close(done)
		layerResult := make(map[string]float64, len(layer))
		var firstErr error
		for r := range done {
			if r.err != nil && firstErr == nil {
				firstErr = fmt.Errorf("task %q: %w", r.id, r.err)
			}
			layerResult[r.id] = r.v
		}
		if firstErr != nil {
			return Report{}, firstErr
		}
		// Deterministic commit order, independent of completion order.
		for _, t := range layer {
			results[t.ID] = layerResult[t.ID]
		}
	}
	current.Results = results
	current.Epoch++
	return Report{Version: ProtocolVersion, FieldID: spec.FieldID, Epoch: current.Epoch, UnitCount: spec.UnitCount, Layers: len(layers), TaskCount: len(spec.Tasks), Results: cloneResults(results), DurationMicros: time.Since(started).Microseconds(), SpecDigest: spec.Digest()}, nil
}

func cloneResults(in map[string]float64) map[string]float64 {
	out := make(map[string]float64, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}
