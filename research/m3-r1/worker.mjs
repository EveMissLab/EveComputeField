// Opt-in trusted local workload: versioned JSON stdin -> state+receipt JSON stdout.
import { performance } from 'node:perf_hooks';
import { ResearchSolver, KERNEL_SHA } from './solver.mjs';
import { appendAdvance } from './organization-log.mjs';
let solver;
try {
  const chunks = []; let bytes = 0;
  for await (const chunk of process.stdin) { bytes += chunk.length; if (bytes > 65536) throw Error('request exceeds 64KiB'); chunks.push(chunk); }
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (input.schema !== 'ecf-fluid-advance/v1') throw Error('unsupported workload schema');
  const allowed = ['schema', 'config', 'options', 'checkpoint', 'advance_steps', 'advance_seconds', 'organization_history'];
  if (Object.keys(input).some(k => !allowed.includes(k))) throw Error('unknown workload parameter');
  if (input.checkpoint && input.config) throw Error('choose checkpoint or new configuration');
  if (input.options?.fault && input.options.fault !== 'none') throw Error('fault injection belongs to direct-study controls, not persisted field state');
  if (input.advance_steps !== undefined && input.advance_seconds !== undefined) throw Error('choose one advance rule');
  const start = performance.now();
  solver = input.checkpoint ? ResearchSolver.restore(input.checkpoint, input.options ?? {}) : new ResearchSolver(input.config ?? {}, input.options ?? {});
  const before = solver.checkpoint();
  const ready = performance.now();
  if (input.advance_steps !== undefined) solver.advanceSteps(input.advance_steps);
  else solver.advanceSeconds(input.advance_seconds ?? solver.config.duration_s);
  const done = performance.now(), checkpoint = solver.checkpoint();
  const result = { schema: 'ecf-fluid-result/v1', kernel_sha256: KERNEL_SHA, metrics: solver.measure(), organization: solver.receipt(), checkpoint,
    organization_history: appendAdvance(input.organization_history ?? [], before, checkpoint, solver.receipt()),
    timing: { setup_ms: ready - start, advance_ms: done - ready, total_before_serialization_ms: performance.now() - start }, rss_bytes: process.memoryUsage().rss };
  await solver.close(); solver = null;
  const output = JSON.stringify(result); if (Buffer.byteLength(output) > 131072) throw Error('result exceeds registered limit');
  process.stdout.write(output + '\n');
} catch (error) { if (solver) await solver.close(); console.error(error.message); process.exitCode = 1; }
