import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { speed, rusanov, updateRange } from './numerics.mjs';
const require = createRequire(import.meta.url);
const { validate, DEFAULTS } = require('../../examples/fluid/fluid-core.js');
export function canonical(v) { if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`; if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`; return JSON.stringify(v); }
export const digest = v => createHash('sha256').update(typeof v === 'string' ? v : canonical(v)).digest('hex');
export const KERNEL_SHA = digest(['solver.mjs', 'numerics.mjs', 'partition-worker.mjs', '../../examples/fluid/fluid-core.js'].map(name => readFileSync(new URL(name, import.meta.url), 'utf8').replace(/\r\n?/g, '\n')).join('\n'));
const BASE_OPTIONS = { precision: 'f64', dt_max: .03, cfl: .39, partitions: 1, organization: 'monolithic', forcing: 'constant', time_mode: 'adaptive', fault: 'none' };
const PHYSICS_KEYS = ['precision', 'dt_max', 'cfl', 'forcing', 'time_mode', 'fault'];
const shared = (Type, count) => new Type(new SharedArrayBuffer(Type.BYTES_PER_ELEMENT * count));
function checkedOptions(config, input) {
  const o = { ...BASE_OPTIONS, ...input };
  if (!['f64', 'f32-state'].includes(o.precision)) throw Error('unsupported precision');
  if (!(Number.isFinite(o.dt_max) && o.dt_max > 0 && o.dt_max <= 1)) throw Error('invalid dt_max');
  if (!(Number.isFinite(o.cfl) && o.cfl > 0 && o.cfl <= 4)) throw Error('invalid CFL');
  if (!Number.isInteger(o.partitions) || o.partitions < 1 || o.partitions > 16 || config.cells % o.partitions) throw Error('partitions must divide the grid, in 1..16');
  if (!['monolithic', 'partitioned-serial', 'partitioned-workers'].includes(o.organization)) throw Error('invalid organization');
  if (o.organization === 'monolithic' && o.partitions !== 1) throw Error('monolithic requires one partition');
  if (o.organization === 'partitioned-workers' && o.partitions < 2) throw Error('workers require at least two partitions');
  if (!['constant', 'inlet-pulse', 'tide-oscillation'].includes(o.forcing)) throw Error('invalid forcing');
  if (!['adaptive', 'fixed'].includes(o.time_mode)) throw Error('invalid time mode');
  if (!['none', 'broken-interface'].includes(o.fault)) throw Error('invalid fault');
  if (o.fault !== 'none' && (o.organization !== 'partitioned-serial' || o.partitions < 2)) throw Error('interface fault is a partitioned-serial negative control only');
  return o;
}

class CellPool {
  constructor(solver, options = solver.options) {
    this.count = options.partitions;
    this.control = shared(Int32Array, 5); this.parameters = shared(Float64Array, 3);
    const buffers = Object.fromEntries(['h', 'q', 'nh', 'nq', 'fh', 'fq'].map(k => [k, solver[k].buffer]));
    buffers.control = this.control.buffer; buffers.parameters = this.parameters.buffer;
    this.workers = Array.from({ length: this.count }, (_, p) => new Worker(new URL('./partition-worker.mjs', import.meta.url), {
      workerData: { buffers, precision: options.precision, n: solver.n, start: p * solver.n / this.count, end: (p + 1) * solver.n / this.count }, execArgv: [],
    }));
    this.workers.forEach(w => w.on('error', e => { this.error = e; }));
    const deadline = performance.now() + 10000;
    while (true) {
      const ready = Atomics.load(this.control, 4); if (ready >= this.count) break;
      if (performance.now() > deadline) { this.workers.forEach(w => w.terminate()); throw Error('worker startup deadline exceeded'); }
      Atomics.wait(this.control, 4, ready, 100);
    }
  }
  update(dt, dx, roughness) {
    if (this.error) throw this.error;
    this.parameters.set([dt, dx, roughness]);
    Atomics.store(this.control, 2, 0); Atomics.store(this.control, 3, 0); Atomics.store(this.control, 1, 1);
    Atomics.add(this.control, 0, 1); Atomics.notify(this.control, 0);
    const deadline = performance.now() + 10000;
    while (true) {
      const completed = Atomics.load(this.control, 2); if (completed >= this.count) break;
      if (performance.now() > deadline) throw Error('worker barrier deadline exceeded');
      Atomics.wait(this.control, 2, completed, 100);
    }
    return Atomics.load(this.control, 3) - 1;
  }
  async close() {
    Atomics.store(this.control, 1, 3); Atomics.add(this.control, 0, 1); Atomics.notify(this.control, 0);
    await Promise.all(this.workers.map(w => w.terminate()));
  }
}

export class ResearchSolver {
  constructor(config = {}, options = {}) {
    this.config = { ...DEFAULTS, ...config }; validate(this.config);
    if (!Number.isFinite(this.config.duration_s) || this.config.duration_s <= 0 || this.config.duration_s > 30) throw Error('duration_s must be (0,30]');
    this.options = checkedOptions(this.config, options);
    this.n = this.config.cells; this.dx = 96 / this.n;
    const Type = this.options.precision === 'f64' ? Float64Array : Float32Array;
    this.bed = new Float64Array(this.n);
    for (const k of ['h', 'q', 'nh', 'nq']) this[k] = shared(Type, this.n);
    this.fh = shared(Float64Array, this.n + 1); this.fq = shared(Float64Array, this.n + 1);
    for (let i = 0; i < this.n; i++) { const f = (i + .5) / this.n; this.bed[i] = 1.05 - .72 * f; this.h[i] = (2.15 - .62 * f) - this.bed[i]; this.q[i] = .8; }
    this.time = 0; this.steps = 0; this.massIn = 0; this.massOut = 0; this.targetIn = 0; this.maxCFL = 0;
    this.minDt = 0; this.maxDt = 0; this.initialMass = this.mass(); this.barriers = 0; this.changes = [];
    this.closed = false;
    this.makePool = options => new CellPool(this, options);
    this.pool = this.options.organization === 'partitioned-workers' ? this.makePool(this.options) : null;
  }
  mass() { let m = 0; for (let i = 0; i < this.n; i++) m += this.h[i] * this.dx; return m; }
  boundary() {
    let inflow = this.config.inflow_m2_s, tide = this.config.tide_m;
    if (this.options.forcing === 'inlet-pulse' && this.time >= 2 && this.time < 4) inflow = Math.min(2.5, inflow * 1.8);
    if (this.options.forcing === 'tide-oscillation') tide = Math.max(-.4, Math.min(.4, tide + .2 * Math.sin(2 * Math.PI * this.time / 6)));
    return { inflow, tide };
  }
  step(want = this.options.dt_max) {
    if (this.closed) throw Error('solver is closed');
    if (!(want > 0) || !Number.isFinite(want)) throw Error('invalid step length');
    let fastest = 0; for (let i = 0; i < this.n; i++) fastest = Math.max(fastest, speed(this.h[i], this.q[i]));
    const dt = this.options.time_mode === 'adaptive' ? Math.min(want, this.options.dt_max, this.options.cfl * this.dx / fastest) : Math.min(want, this.options.dt_max);
    if (!(dt > 0) || !Number.isFinite(dt)) throw Error('invalid adaptive timestep');
    const boundary = this.boundary(), c = this.config, n = this.n;
    let f = rusanov(1.1, boundary.inflow, this.h[0], this.q[0]); this.fh[0] = f[0]; this.fq[0] = f[1];
    for (let i = 1; i < n; i++) { f = rusanov(this.h[i - 1], this.q[i - 1], this.h[i], this.q[i]); this.fh[i] = f[0]; this.fq[i] = f[1]; }
    f = rusanov(this.h[n - 1], this.q[n - 1], Math.max(.08, 1.53 + boundary.tide - this.bed[n - 1]), this.q[n - 1]); this.fh[n] = f[0]; this.fq[n] = f[1];
    let failed = -1;
    if (this.pool) { failed = this.pool.update(dt, this.dx, c.roughness); this.barriers++; }
    else {
      const width = n / this.options.partitions;
      const broken = this.options.fault === 'broken-interface' ? Array.from({ length: this.options.partitions - 1 }, (_, p) => (p + 1) * width) : [];
      for (let p = 0; p < this.options.partitions; p++) {
        failed = updateRange(this.h, this.q, this.fh, this.fq, this.nh, this.nq, p * width, (p + 1) * width, dt, this.dx, c.roughness, broken);
        if (failed >= 0) break;
      }
    }
    this.maxCFL = Math.max(this.maxCFL, dt * fastest / this.dx);
    if (failed >= 0) throw Error(`numerical stability failure at cell ${failed}, t=${this.time}`);
    this.massIn += dt * this.fh[0]; this.massOut += dt * this.fh[n]; this.targetIn += dt * boundary.inflow;
    this.h.set(this.nh); this.q.set(this.nq); this.time += dt; this.steps++;
    this.minDt = this.minDt === 0 ? dt : Math.min(this.minDt, dt); this.maxDt = Math.max(this.maxDt, dt);
    return dt;
  }
  advanceSteps(count) { if (!Number.isInteger(count) || count < 0 || count > 10000) throw Error('steps must be integer in 0..10000'); for (let i = 0; i < count; i++) this.step(); }
  advanceSeconds(seconds) { if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 30) throw Error('advance seconds must be (0,30]'); let remaining = seconds, loops = 0; while (remaining > 1e-11) { if (++loops > 25000) throw Error('step budget exceeded'); remaining -= this.step(remaining); } }
  measure() {
    const mass = this.mass();
    return { time_s: this.time, steps: this.steps, cells: this.n, water_m2: mass, mass_residual_m2: mass - this.initialMass - this.massIn + this.massOut,
      initial_water_m2: this.initialMass, boundary_in_m2: this.massIn, boundary_out_m2: this.massOut, nominal_source_integral_m2: this.targetIn,
      actual_minus_nominal_inlet_m2: this.massIn - this.targetIn, min_depth_m: Math.min(...this.h), max_depth_m: Math.max(...this.h),
      min_dt_s: this.minDt, max_dt_s: this.maxDt, max_cfl: this.maxCFL, outlet_depth_m: this.h[this.n - 1], outlet_flux_m2_s: this.fh[this.n] };
  }
  checkpoint() {
    const snapshot = { schema: 'ecf-fluid-state/v1', kernel_sha256: KERNEL_SHA, config: this.config,
      physics_options: Object.fromEntries(PHYSICS_KEYS.map(k => [k, this.options[k]])), bed_sha256: digest([...this.bed]),
      h: [...this.h], q: [...this.q], fh: [...this.fh], fq: [...this.fq], time: this.time, steps: this.steps, initialMass: this.initialMass,
      massIn: this.massIn, massOut: this.massOut, targetIn: this.targetIn, maxCFL: this.maxCFL, minDt: this.minDt, maxDt: this.maxDt };
    return { ...snapshot, integrity_sha256: digest(snapshot) };
  }
  static restore(checkpoint, organization = {}) {
    const { integrity_sha256, ...s } = checkpoint;
    if (s.schema !== 'ecf-fluid-state/v1' || s.kernel_sha256 !== KERNEL_SHA || digest(s) !== integrity_sha256) throw Error('checkpoint version, kernel or integrity mismatch');
    for (const k of PHYSICS_KEYS) if (Object.hasOwn(organization, k) && organization[k] !== s.physics_options[k]) throw Error('resume cannot silently change physical options');
    const count = s.config?.cells;
    for (const k of ['h', 'q', 'fh', 'fq']) if (!Array.isArray(s[k]) || s[k].length !== count + (k.startsWith('f') ? 1 : 0) || !s[k].every(Number.isFinite)) throw Error('checkpoint array invalid');
    if (!s.h.every(h => h >= .02) || !Number.isInteger(s.steps) || s.steps < 0) throw Error('checkpoint physical state invalid');
    for (const k of ['time', 'initialMass', 'massIn', 'massOut', 'targetIn', 'maxCFL', 'minDt', 'maxDt']) if (!Number.isFinite(s[k])) throw Error('checkpoint scalar invalid');
    if (s.time < 0 || s.initialMass <= 0 || s.targetIn < 0 || s.maxCFL < 0 || s.minDt < 0 || s.maxDt < s.minDt) throw Error('checkpoint scalar range invalid');
    if (s.steps === 0 ? (s.time !== 0 || s.minDt !== 0 || s.maxDt !== 0) : (s.time <= 0 || s.minDt <= 0 || s.time < s.steps * s.minDt - 1e-8 || s.time > s.steps * s.maxDt + 1e-8)) throw Error('checkpoint time ledger inconsistent');
    if (s.physics_options.precision === 'f32-state' && ![...s.h, ...s.q].every(x => Math.fround(x) === x)) throw Error('checkpoint precision mismatch');
    const restoredMass = s.h.reduce((m, h) => m + h * (96 / count), 0);
    const scale = Math.max(1, restoredMass, s.initialMass, Math.abs(s.massIn), Math.abs(s.massOut));
    const tolerance = s.physics_options.precision === 'f64' ? 1e-8 : 8 * 2 ** -23 * scale * Math.max(1, s.steps);
    if (Math.abs(restoredMass - s.initialMass - s.massIn + s.massOut) > tolerance) throw Error('checkpoint mass/flux ledger inconsistent');
    const solver = new ResearchSolver(s.config, { ...s.physics_options, ...organization });
    if (s.bed_sha256 !== digest([...solver.bed])) { solver.close(); throw Error('checkpoint bed/grid mismatch'); }
    for (const k of ['h', 'q', 'fh', 'fq']) solver[k].set(s[k]);
    for (const k of ['time', 'steps', 'initialMass', 'massIn', 'massOut', 'targetIn', 'maxCFL', 'minDt', 'maxDt']) solver[k] = s[k];
    return solver;
  }
  receipt() { return { organization: this.options.organization, partitions: this.options.partitions, cells_per_partition: this.n / this.options.partitions,
    shared_internal_faces: this.options.partitions - 1, barriers: this.barriers, changes: this.changes,
    serial_components: ['global timestep', 'one flux per face', 'ordered mass reduction'], precision: this.options.precision }; }
  async reorganize(partitions, organization) {
    if (this.closed) throw Error('solver is closed');
    const options = checkedOptions(this.config, { ...this.options, partitions, organization });
    const previous = this.receipt(), before = this.checkpoint().integrity_sha256;
    // Prepare and health-check the replacement BEFORE touching the prior pool/options.
    const replacement = organization === 'partitioned-workers' ? this.makePool(options) : null;
    try { await this.pool?.close(); } catch (error) { await replacement?.close(); this.closed = true; throw error; }
    this.pool = replacement; this.options = options;
    this.changes.push({ at_step: this.steps, at_time_s: this.time, old_organization: previous.organization,
      old_partitions: previous.partitions, new_partitions: partitions, organization, success: true,
      kernel_sha256: KERNEL_SHA, config_sha256: digest(this.config), state_sha256: before });
  }
  async close() { const pool = this.pool; this.pool = null; this.closed = true; if (pool) await pool.close(); }
}
