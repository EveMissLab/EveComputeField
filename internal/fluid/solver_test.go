package fluid

import (
	"encoding/json"
	"math"
	"testing"
)

func base() Config { return Config{Cells: 96, Duration: 8, Inflow: 1.0, Tide: 0, Roughness: 0.03} }
func TestFiniteVolumeConservesMass(t *testing.T) {
	r, e := Run(base())
	if e != nil {
		t.Fatal(e)
	}
	if math.Abs(r.MassResidualM2) > 1e-8 {
		t.Fatalf("mass residual %g", r.MassResidualM2)
	}
	if r.MaxCFL > 0.3900001 || r.Steps < 10 {
		t.Fatalf("CFL=%g steps=%d", r.MaxCFL, r.Steps)
	}
	for _, s := range r.Samples {
		if s.DepthM <= 0 || math.IsNaN(s.VelocityMS) {
			t.Fatalf("unphysical sample %+v", s)
		}
	}
}
func TestDeterministicResult(t *testing.T) {
	a, e := Run(base())
	if e != nil {
		t.Fatal(e)
	}
	b, e := Run(base())
	if e != nil {
		t.Fatal(e)
	}
	aa, _ := json.Marshal(a)
	bb, _ := json.Marshal(b)
	if string(aa) != string(bb) {
		t.Fatal("nondeterministic simulation")
	}
}
func TestTideAndInflowChangeSolution(t *testing.T) {
	a, _ := Run(base())
	c := base()
	c.Tide = 0.3
	b, e := Run(c)
	if e != nil {
		t.Fatal(e)
	}
	if math.Abs(a.Samples[len(a.Samples)-1].DepthM-b.Samples[len(b.Samples)-1].DepthM) < 0.015 {
		t.Fatal("tailwater boundary has no downstream effect")
	}
	c = base()
	c.Inflow = 2.0
	d, e := Run(c)
	if e != nil {
		t.Fatal(e)
	}
	if math.Abs(d.Samples[0].VelocityMS-a.Samples[0].VelocityMS) < 0.04 {
		t.Fatal("inflow has no upstream effect")
	}
}
func TestRejectMalformedConfig(t *testing.T) {
	for _, mutate := range []func(*Config){
		func(c *Config) { c.Cells = 10 }, func(c *Config) { c.Duration = 31 }, func(c *Config) { c.Duration = math.NaN() },
		func(c *Config) { c.Inflow = -2 }, func(c *Config) { c.Tide = 1 }, func(c *Config) { c.Roughness = 0 },
	} {
		c := base()
		mutate(&c)
		if _, e := Run(c); e == nil {
			t.Fatalf("accepted invalid config %+v", c)
		}
	}
}
func TestBoundaryExtremes(t *testing.T) {
	for _, c := range []Config{
		{Cells: 16, Duration: 25, Inflow: 0.05, Tide: -0.4, Roughness: 0.08},
		{Cells: 512, Duration: 10, Inflow: 2.5, Tide: 0.4, Roughness: 0.01},
	} {
		r, e := Run(c)
		if e != nil {
			t.Fatalf("%+v: %v", c, e)
		}
		if math.Abs(r.MassResidualM2) > 1e-7 {
			t.Fatalf("bad mass at extreme: %+v", c)
		}
	}
}
