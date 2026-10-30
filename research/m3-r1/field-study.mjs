import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { ResearchSolver, digest, KERNEL_SHA } from './solver.mjs';
import { verifyHistory } from './organization-log.mjs';
import { originFor } from '../runtime-config.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../..'), out = path.join(here, 'results');
await mkdir(out, { recursive: true }); await mkdir(path.join(here, '.runtime'), { recursive: true });
const token = (await readFile(path.join(repo, '.evefield-local/control.token'), 'utf8')).trim();
const endpoint = originFor(8765), headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
async function api(method, route, body, allowFailure = false) {
  const response = await fetch(endpoint + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  if (!response.ok && !allowFailure) throw Error(`HTTP ${response.status}: ${text}`);
  let value = null; if (text) { try { value = JSON.parse(text); } catch { value = { message: text }; } }
  return { status: response.status, value };
}
const savedPath = path.join(out, 'field-study.json');
async function main() {
if (process.argv.includes('--verify-restart')) {
  const report = JSON.parse(await readFile(savedPath, 'utf8'));
  const restored = (await api('GET', `/v1/fields/${report.field_id}`)).value;
  const stored = (await api('GET', `/v1/fields/${report.field_id}/memory/continuity/latest`)).value;
  const result = JSON.parse(stored.value); verifyHistory(result.organization_history);
  assert.equal(result.checkpoint.integrity_sha256, report.final_checkpoint_sha256);
  assert.equal(result.organization_history.at(-1).receipt_sha256, report.organization_history_head);
  assert.equal(restored.logical_units, 720); assert.equal(restored.epoch, 1);
  report.restart_verified = true; report.restored = { logical_units: restored.logical_units, epoch: restored.epoch, state_sha256: result.checkpoint.integrity_sha256, receipt_count: result.organization_history.length };
  await writeFile(savedPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.restored));
  return;
}
const fieldID = `m3-r1-${Date.now().toString(36)}`;
const spec = JSON.parse(await readFile(path.join(repo, 'examples/local.json'), 'utf8')); spec.field_id = fieldID; spec.unit_count = 96;
await api('POST', '/v1/fields', spec); await api('POST', `/v1/fields/${fieldID}/run`);
const trace = [], organizations = [[1,'monolithic'],[2,'partitioned-serial'],[4,'partitioned-workers'],[2,'partitioned-workers']];
let result;
for (let index = 0; index < organizations.length; index++) {
  const [partitions, organization] = organizations[index];
  if (index === 2) await api('PUT', `/v1/fields/${fieldID}/resize`, { unit_count: 720 });
  const request = { schema: 'ecf-fluid-advance/v1', options: { partitions, organization }, advance_steps: 80 };
  if (result) { request.checkpoint = result.checkpoint; request.organization_history = result.organization_history; }
  const begin = performance.now();
  const invocation = (await api('POST', `/v1/fields/${fieldID}/invoke/fluid-research`, { input: JSON.stringify(request), save_domain: 'continuity', save_key: 'latest' })).value;
  const end = performance.now(); assert.equal(invocation.saved, true); result = JSON.parse(invocation.stdout); verifyHistory(result.organization_history);
  const row = { index, steps: result.metrics.steps, time_s: result.metrics.time_s, partitions, organization,
    field_http_invoke_and_save_ms: end - begin, worker: result.timing, checkpoint_bytes: Buffer.byteLength(JSON.stringify(result.checkpoint)),
    mass_residual_m2: result.metrics.mass_residual_m2, state_sha256: result.checkpoint.integrity_sha256, receipt_sha256: result.organization_history.at(-1).receipt_sha256 };
  trace.push(row); await appendFile(path.join(out, 'field-events.jsonl'), JSON.stringify({ field_id: fieldID, ...row }) + '\n');
}
const direct = new ResearchSolver();
try { direct.advanceSteps(320); assert.equal(result.checkpoint.integrity_sha256, direct.checkpoint().integrity_sha256); }
finally { await direct.close(); }
const storedBefore = (await api('GET', `/v1/fields/${fieldID}/memory/continuity/latest`)).value.value;
const rejected = await api('POST', `/v1/fields/${fieldID}/invoke/fluid-research`, { input: JSON.stringify({ schema: 'ecf-fluid-advance/v1', checkpoint: result.checkpoint, organization_history: result.organization_history, options: { partitions: 5 }, advance_steps: 1 }), save_domain: 'continuity', save_key: 'latest' }, true);
assert(rejected.status >= 400);
assert.equal((await api('GET', `/v1/fields/${fieldID}/memory/continuity/latest`)).value.value, storedBefore);
await appendFile(path.join(out, 'field-events.jsonl'), JSON.stringify({ field_id: fieldID, attempt: 'invalid-reorganization', requested_partitions: 5, success: false, http_status: rejected.status, preserved_state_sha256: result.checkpoint.integrity_sha256 }) + '\n');
const report = { schema: 'ecf-m3-r1-field-study/v1', field_id: fieldID, kernel_sha256: KERNEL_SHA, endpoint,
  logical_units_final: 720, trace, uninterrupted_320_steps_equivalent: true,
  final_checkpoint_sha256: result.checkpoint.integrity_sha256, organization_history_head: result.organization_history.at(-1).receipt_sha256,
  failed_reorganization_preserves_saved_state: true, restart_verified: false,
  distinction: 'Field logical units are metadata. Real partitions are explicit worker cell ranges, not automatic DAG distribution.' };
await writeFile(savedPath, JSON.stringify(report, null, 2) + '\n');
await writeFile(path.join(here, '.runtime/current.json'), JSON.stringify({ field_id: fieldID, endpoint, latest_key: 'continuity/latest' }, null, 2));
console.log(JSON.stringify(report));
}
await main();
