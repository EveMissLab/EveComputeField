/* EveComputeField local SVG fluid benchmark — deterministic browser-side 1D
 * Saint-Venant/Rusanov solver. No network, Canvas, or WebGL dependencies.
 * Source model: internal/fluid/solver.go (Go CLI benchmark). MIT.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EveFluid = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const G = 9.81;
  const DEFAULTS = Object.freeze({cells: 96, duration_s: 8, inflow_m2_s: 1, tide_m: 0, roughness: .03});
  function validate(c) {
    if (!Number.isInteger(c.cells) || c.cells < 16 || c.cells > 512) throw new Error('cells must be 16..512');
    if (!Number.isFinite(c.inflow_m2_s) || c.inflow_m2_s < .05 || c.inflow_m2_s > 2.5) throw new Error('inflow outside [0.05, 2.5]');
    if (!Number.isFinite(c.tide_m) || Math.abs(c.tide_m) > .4) throw new Error('tide outside [-0.4, 0.4]');
    if (!Number.isFinite(c.roughness) || c.roughness < .01 || c.roughness > .08) throw new Error('roughness outside [0.01, 0.08]');
  }
  function flux(h, q) {
    const hh = Math.max(h, .00001);
    return [q, q*q/hh + .5*G*hh*hh];
  }
  function speed(h, q) { const hh=Math.max(h,.00001);return Math.abs(q/hh) + Math.sqrt(G*hh); }
  function rusanov(ah, aq, bh, bq) {
    const a=flux(ah,aq), b=flux(bh,bq), wave=Math.max(speed(ah,aq), speed(bh,bq));
    return [.5*(a[0]+b[0])-.5*wave*(bh-ah), .5*(a[1]+b[1])-.5*wave*(bq-aq)];
  }
  class Solver {
    constructor(config={}) {
      const c=Object.assign({}, DEFAULTS, config); validate(c); this.config=c;
      this.n=c.cells; this.dx=96/this.n;
      this.bed=new Float64Array(this.n);this.h=new Float64Array(this.n);this.q=new Float64Array(this.n);
      this.nh=new Float64Array(this.n);this.nq=new Float64Array(this.n);
      this.fh=new Float64Array(this.n+1);this.fq=new Float64Array(this.n+1);
      for (let i=0;i<this.n;i++) {
        const f=(i+.5)/this.n;
        this.bed[i]=1.05-.72*f;
        this.h[i]=(2.15-.62*f)-this.bed[i];
        this.q[i]=.8;
      }
      this.time=0;this.steps=0;this.massIn=0;this.massOut=0;this.maxCFL=0;
      this.initialMass=this.mass();
    }
    mass() { let s=0;for(let i=0;i<this.n;i++)s+=this.h[i]*this.dx;return s; }
    setParameters(p) {const c=Object.assign({},this.config,p);validate(c);this.config=c;}
    step(want=.03) {
      if (!(want>0) || !Number.isFinite(want))throw Error('invalid step length');
      let fastest=0;for(let i=0;i<this.n;i++)fastest=Math.max(fastest,speed(this.h[i],this.q[i]));
      const dt=Math.min(want, .03, .39*this.dx/fastest);
      this.maxCFL=Math.max(this.maxCFL,dt*fastest/this.dx);
      const c=this.config, n=this.n;
      let f=rusanov(1.1,c.inflow_m2_s,this.h[0],this.q[0]);this.fh[0]=f[0];this.fq[0]=f[1];
      for(let i=1;i<n;i++) {f=rusanov(this.h[i-1],this.q[i-1],this.h[i],this.q[i]);this.fh[i]=f[0];this.fq[i]=f[1];}
      f=rusanov(this.h[n-1],this.q[n-1],Math.max(.08,1.53+c.tide_m-this.bed[n-1]),this.q[n-1]);
      this.fh[n]=f[0];this.fq[n]=f[1];
      for(let i=0;i<n;i++) {
        const h=this.h[i],q=this.q[i];
        const hh=h-dt/this.dx*(this.fh[i+1]-this.fh[i]);
        const qq=q-dt/this.dx*(this.fq[i+1]-this.fq[i])
          +dt*(G*h*(.72/96)-G*c.roughness*c.roughness*q*Math.abs(q)/Math.pow(Math.max(h,.08),7/3));
        if (!(hh>=.02) || !Number.isFinite(qq))throw Error('numerical stability failure at cell '+i);
        this.nh[i]=hh;this.nq[i]=qq;
      }
      this.massIn+=dt*this.fh[0];this.massOut+=dt*this.fh[n];
      [this.h,this.nh]=[this.nh,this.h];[this.q,this.nq]=[this.nq,this.q];
      this.time+=dt;this.steps++;
      return dt;
    }
    advance(seconds) {
      let remaining=seconds, loops=0;
      while(remaining>1e-11) {
        if(++loops>25000)throw Error('step budget exceeded');
        remaining-=this.step(remaining);
      }
    }
    measure() {
      const finalMass=this.mass(),end=this.n-1;
      return {time_s:this.time,steps:this.steps,cells:this.n,inflow_m2_s:this.config.inflow_m2_s,
        outflow_m2_s:this.fh[end+1]||0,water_m2:finalMass,velocity_ms:this.q[Math.floor(this.n/2)]/this.h[Math.floor(this.n/2)],
        mass_residual_m2:finalMass-this.initialMass-this.massIn+this.massOut,max_cfl:this.maxCFL};
    }
    sample(f) {const i=Math.max(0,Math.min(this.n-1,Math.floor(f*this.n)));return {h:this.h[i],q:this.q[i],u:this.q[i]/this.h[i],surface:this.h[i]+this.bed[i]};}
  }
  return {Solver,validate,DEFAULTS};
});
