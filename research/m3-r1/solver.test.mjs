import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { ResearchSolver, digest } from './solver.mjs';
const require = createRequire(import.meta.url);
const { Solver } = require('../../examples/fluid/fluid-core.js');
const state = s => ({ h: [...s.h], q: [...s.q], time: s.time, steps: s.steps, massIn: s.massIn, massOut: s.massOut });

test('default research kernel reproduces the unchanged M3 reference state', async () => {
  const r = new Solver(), s = new ResearchSolver();
  try { for (let i = 0; i < 120; i++) { r.step(); s.step(); } assert.deepEqual(state(s), state(r)); }
  finally { await s.close(); }
});
test('serial partitions preserve exact state and global mass', async () => {
  const a = new ResearchSolver(), b = new ResearchSolver({}, { partitions: 4, organization: 'partitioned-serial' });
  try { a.advanceSteps(120); b.advanceSteps(120); assert.deepEqual(state(a), state(b)); assert(Math.abs(b.measure().mass_residual_m2) < 1e-9); }
  finally { await a.close(); await b.close(); }
});
test('actual worker partitions share flux and reproduce serial computation', async () => {
  const a = new ResearchSolver(), b = new ResearchSolver({}, { partitions: 4, organization: 'partitioned-workers' });
  try { a.advanceSteps(60); b.advanceSteps(60); assert.deepEqual(state(a), state(b)); assert.equal(b.receipt().barriers, 60); }
  finally { await a.close(); await b.close(); }
});
test('checkpoint resumes complete arrays, time and flux integrals exactly', async () => {
  const a = new ResearchSolver(), b = new ResearchSolver(); let c;
  try { a.advanceSteps(240); b.advanceSteps(120); c = ResearchSolver.restore(JSON.parse(JSON.stringify(b.checkpoint())), { partitions: 2, organization: 'partitioned-serial' }); c.advanceSteps(120); assert.deepEqual(state(a), state(c)); assert.equal(a.checkpoint().integrity_sha256, c.checkpoint().integrity_sha256); }
  finally { await a.close(); await b.close(); await c?.close(); }
});
test('quiescent reorganization leaves physical state unchanged', async () => {
  const a = new ResearchSolver(), b = new ResearchSolver();
  try { a.advanceSteps(180); b.advanceSteps(60); const before = b.checkpoint().integrity_sha256; await b.reorganize(4, 'partitioned-serial'); assert.equal(before, b.checkpoint().integrity_sha256); b.advanceSteps(60); await b.reorganize(2, 'partitioned-workers'); b.advanceSteps(60); assert.deepEqual(state(a), state(b)); }
  finally { await a.close(); await b.close(); }
});
test('float32-state quantization is explicit and checkpointable', async () => {
  const s = new ResearchSolver({}, { precision: 'f32-state' }); let r;
  try { s.advanceSteps(60); assert([...s.h, ...s.q].every(x => Math.fround(x) === x)); r = ResearchSolver.restore(s.checkpoint()); assert.deepEqual(state(s), state(r)); }
  finally { await s.close(); await r?.close(); }
});
test('a broken inter-partition mass flux is detected by conservation', async () => {
  const s = new ResearchSolver({}, { partitions: 4, organization: 'partitioned-serial', fault: 'broken-interface' });
  try { s.advanceSteps(40); assert(Math.abs(s.measure().mass_residual_m2) > 1e-6); }
  finally { await s.close(); }
});
test('malformed configuration and corrupt checkpoints fail closed', async () => {
  assert.throws(() => new ResearchSolver({ cells: 10 }));
  assert.throws(() => new ResearchSolver({}, { dt_max: NaN }));
  assert.throws(() => new ResearchSolver({}, { partitions: 5 }));
  const s = new ResearchSolver();
  try { const c = s.checkpoint(); c.h[0] = -1; assert.throws(() => ResearchSolver.restore(c)); const d = s.checkpoint(); d.kernel_sha256 = 'wrong'; assert.throws(() => ResearchSolver.restore(d)); }
  finally { await s.close(); }
});
test('time-varying upstream forcing changes physical state and receipts', async () => {
  const a = new ResearchSolver(), b = new ResearchSolver({}, { forcing: 'inlet-pulse' });
  try { a.advanceSeconds(8); b.advanceSeconds(8); assert.notDeepEqual([...a.h], [...b.h]); assert.notEqual(a.targetIn, b.targetIn); }
  finally { await a.close(); await b.close(); }
});
test('failed replacement worker startup preserves the previous live organization', async () => {
  const s = new ResearchSolver({}, { partitions: 2, organization: 'partitioned-workers' });
  try {
    s.advanceSteps(20); const before = s.checkpoint().integrity_sha256, pool = s.pool, factory = s.makePool;
    s.makePool = () => { throw Error('forced startup failure'); };
    await assert.rejects(s.reorganize(4, 'partitioned-workers'), /forced startup failure/);
    assert.equal(s.pool, pool); assert.equal(s.options.partitions, 2); assert.equal(s.changes.length, 0);
    assert.equal(s.checkpoint().integrity_sha256, before); s.makePool = factory; s.advanceSteps(20);
    assert.equal(s.receipt().barriers, 40);
  } finally { await s.close(); }
});
test('semantic checkpoint ledger validation survives a recomputed integrity digest', async () => {
  const s = new ResearchSolver();
  try {
    s.advanceSteps(20); const c = s.checkpoint(); c.initialMass += 1;
    const { integrity_sha256, ...content } = c; c.integrity_sha256 = digest(content);
    assert.throws(() => ResearchSolver.restore(c), /mass\/flux ledger/);
  } finally { await s.close(); }
});
test('dynamic tide forcing resumes from restored time, not from a new forcing origin', async () => {
  const a = new ResearchSolver({}, { forcing: 'tide-oscillation' }), b = new ResearchSolver({}, { forcing: 'tide-oscillation' }); let c;
  try { a.advanceSteps(240); b.advanceSteps(120); c = ResearchSolver.restore(b.checkpoint()); c.advanceSteps(120); assert.deepEqual(state(a), state(c)); }
  finally { await a.close(); await b.close(); await c?.close(); }
});
