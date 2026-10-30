// Package fluid provides a deterministic 1D finite-volume shallow-water
// reference workload for EveComputeField. This is a research-grade benchmark,
// not a validated 2D coastal/waterfall fluid-dynamics simulator.
package fluid

import (
	"errors"
	"fmt"
	"math"
)

const gravity = 9.81

type Config struct {
	Cells     int     `json:"cells"`
	Duration  float64 `json:"duration_s"`
	Inflow    float64 `json:"inflow_m2_s"`
	Tide      float64 `json:"tide_m"`
	Roughness float64 `json:"roughness"`
}

type Sample struct {
	PositionM  float64 `json:"position_m"`
	DepthM     float64 `json:"depth_m"`
	VelocityMS float64 `json:"velocity_m_s"`
	SurfaceM   float64 `json:"surface_m"`
}

type Result struct {
	Model                   string   `json:"model"`
	Cells                   int      `json:"cells"`
	Steps                   int      `json:"steps"`
	SimulatedSeconds        float64  `json:"simulated_seconds"`
	InflowM2S               float64  `json:"inflow_m2_s"`
	OutflowM2S              float64  `json:"outflow_m2_s"`
	InitialVolumeM2         float64  `json:"initial_volume_m2"`
	FinalVolumeM2           float64  `json:"final_volume_m2"`
	IntegratedBoundaryInM2  float64  `json:"integrated_boundary_in_m2"`
	IntegratedBoundaryOutM2 float64  `json:"integrated_boundary_out_m2"`
	MassResidualM2          float64  `json:"mass_residual_m2"`
	MaxCFL                  float64  `json:"max_cfl"`
	Samples                 []Sample `json:"samples"`
}

// The rectangular channel conserves depth h and discharge per metre of width q=hu.
// Domain bed elevation decreases to a tidal downstream boundary. An upstream
// waterfall is represented by its delivered discharge; its airborne trajectory
// is a separate visual ballistic model. Ocean is a boundary, not a 2D domain.
func Validate(c Config) error {
	if c.Cells < 16 || c.Cells > 512 {
		return errors.New("cells must be 16..512")
	}
	if !finite(c.Duration) || c.Duration <= 0 || c.Duration > 30 {
		return errors.New("duration_s must be (0,30]")
	}
	if !finite(c.Inflow) || c.Inflow < 0.05 || c.Inflow > 2.5 {
		return errors.New("inflow_m2_s must be 0.05..2.5")
	}
	if !finite(c.Tide) || math.Abs(c.Tide) > 0.4 {
		return errors.New("tide_m must be within [-0.4,0.4]")
	}
	if !finite(c.Roughness) || c.Roughness < 0.01 || c.Roughness > 0.08 {
		return errors.New("roughness must be 0.01..0.08")
	}
	return nil
}
func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }

type state struct{ h, q float64 }

func flux(s state) state {
	h := math.Max(s.h, 0.00001)
	return state{s.q, s.q*s.q/h + 0.5*gravity*h*h}
}
func signalSpeed(s state) float64 {
	h := math.Max(s.h, 0.00001)
	return math.Abs(s.q/h) + math.Sqrt(gravity*h)
}
func rusanov(a, b state) state {
	fa, fb := flux(a), flux(b)
	alpha := math.Max(signalSpeed(a), signalSpeed(b))
	return state{0.5*(fa.h+fb.h) - 0.5*alpha*(b.h-a.h),
		0.5*(fa.q+fb.q) - 0.5*alpha*(b.q-a.q)}
}

func Run(c Config) (Result, error) {
	if err := Validate(c); err != nil {
		return Result{}, err
	}
	n := c.Cells
	dx := 96.0 / float64(n)
	cells := make([]state, n)
	beds := make([]float64, n)
	for i := 0; i < n; i++ {
		fraction := (float64(i) + 0.5) / float64(n)
		beds[i] = 1.05 - 0.72*fraction
		// Initial free surface 2.15m upstream, 1.53m at the estuary.
		surface := 2.15 - 0.62*fraction
		cells[i] = state{surface - beds[i], 0.80}
	}
	mass := func() float64 {
		v := 0.0
		for _, s := range cells {
			v += s.h * dx
		}
		return v
	}
	initial := mass()
	inflowIntegrated, outflowIntegrated := 0.0, 0.0
	time, steps, maxCFL := 0.0, 0, 0.0
	faces := make([]state, n+1)
	next := make([]state, n)
	for time < c.Duration-1e-12 {
		maxSpeed := 0.0
		for _, v := range cells {
			maxSpeed = math.Max(maxSpeed, signalSpeed(v))
		}
		dt := math.Min(c.Duration-time, math.Min(0.03, 0.39*dx/maxSpeed))
		if dt <= 0 || !finite(dt) {
			return Result{}, errors.New("invalid adaptive time step")
		}
		maxCFL = math.Max(maxCFL, dt*maxSpeed/dx)
		upstream := state{1.10, c.Inflow}
		tailwater := 1.53 + c.Tide
		downstream := state{math.Max(0.08, tailwater-beds[n-1]), cells[n-1].q}
		faces[0] = rusanov(upstream, cells[0])
		for i := 1; i < n; i++ {
			faces[i] = rusanov(cells[i-1], cells[i])
		}
		faces[n] = rusanov(cells[n-1], downstream)
		for i, v := range cells {
			slope := 0.72 / 96.0
			// Conservative flux divergence plus bed-slope and Manning friction.
			h := v.h - dt/dx*(faces[i+1].h-faces[i].h)
			q := v.q - dt/dx*(faces[i+1].q-faces[i].q)
			q += dt * (gravity*v.h*slope - gravity*c.Roughness*c.Roughness*v.q*math.Abs(v.q)/math.Pow(math.Max(v.h, 0.08), 7.0/3))
			if !finite(h) || !finite(q) || h < 0.02 {
				return Result{}, fmt.Errorf("unstable or dry cell %d at t %.3f", i, time)
			}
			next[i] = state{h, q}
		}
		inflowIntegrated += dt * faces[0].h
		outflowIntegrated += dt * faces[n].h
		cells, next = next, cells
		time += dt
		steps++
		if steps > 30000 {
			return Result{}, errors.New("step limit exceeded")
		}
	}
	final := mass()
	// Flux bookkeeping is in m² for a unit-width river; the sea is an open boundary.
	result := Result{Model: "1D Saint-Venant / Rusanov / finite-volume reference", Cells: n, Steps: steps, SimulatedSeconds: time,
		InflowM2S: c.Inflow, OutflowM2S: faces[n].h,
		InitialVolumeM2: initial, FinalVolumeM2: final, IntegratedBoundaryInM2: inflowIntegrated, IntegratedBoundaryOutM2: outflowIntegrated,
		MassResidualM2: final - initial - inflowIntegrated + outflowIntegrated, MaxCFL: maxCFL}
	for j := 0; j < 17; j++ {
		i := j * (n - 1) / 16
		s := cells[i]
		result.Samples = append(result.Samples, Sample{(float64(i) + 0.5) * dx, s.h, s.q / s.h, s.h + beds[i]})
	}
	return result, nil
}
