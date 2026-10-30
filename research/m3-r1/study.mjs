import { ResearchSolver, KERNEL_SHA, digest } from './solver.mjs';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../..'), results = path.join(here, 'results');
const require = createRequire(import.meta.url), { Solver } = require('../../examples/fluid/fluid-core.js');
await mkdir(results, { recursive: true });
await copyFile(path.join(results, 'study.json'), path.join(results, 'study.initial-order-pilot.json')).catch(error => { if (error.code !== 'ENOENT') throw error; });
const base = { cells: 96, duration_s: 8, inflow_m2_s: 1, tide_m: 0, roughness: .03 };
const rows = [], reference = [], partition = [];
async function run(config, options = {}, seconds = config.duration_s ?? 8) {
  const start = performance.now(); let solver;
  try {
    solver = new ResearchSolver(config, options); const ready = performance.now(); solver.advanceSeconds(seconds); const done = performance.now();
    return { status: 'finite', config: solver.config, options: solver.options, metrics: solver.measure(), checkpoint_sha256: solver.checkpoint().integrity_sha256,
      setup_ms: ready - start, advance_ms: done - ready, total_ms: done - start, receipt: solver.receipt(), h: [...solver.h], q: [...solver.q] };
  } catch (error) { return { status: 'numerical-refusal', config, options, error: error.message, metrics: solver?.measure(), total_ms: performance.now() - start }; }
  finally { await solver?.close(); }
}
function slim(row) { const { h, q, ...rest } = row; return rest; }
const variants = [
  ['base', {}], ['inlet-low', { inflow_m2_s: .05 }], ['inlet-high', { inflow_m2_s: 2.5 }],
  ['tide-low', { tide_m: -.4 }], ['tide-high', { tide_m: .4 }], ['rough-low', { roughness: .01 }], ['rough-high', { roughness: .08 }],
];
for (const cells of [32, 96, 192, 512]) for (const [name, change] of variants) {
  const config = { ...base, ...change, cells }, js = new Solver(config); const begin = performance.now(); js.advance(config.duration_s);
  const native = spawnSync(process.env.ECF_EVEFIELD_BIN??path.join(repo, 'build',process.platform==='win32'?'evefield.exe':'evefield'), ['tool', 'fluid'], { input: JSON.stringify(config), encoding: 'utf8', timeout: 15000, windowsHide: true });
  if (native.status !== 0) throw Error(`Original Go reference failed: ${native.stderr}`);
  const go = JSON.parse(native.stdout), m = js.measure(); let delta = 0;
  for (let j = 0; j < 17; j++) { const i = Math.floor(j * (cells - 1) / 16); delta = Math.max(delta, Math.abs(go.samples[j].depth_m - js.h[i]), Math.abs(go.samples[j].velocity_m_s - js.q[i] / js.h[i])); }
  delta = Math.max(delta, Math.abs(go.final_volume_m2 - m.water_m2), Math.abs(go.integrated_boundary_in_m2 - js.massIn), Math.abs(go.integrated_boundary_out_m2 - js.massOut));
  const row = { name, config, max_abs_go_js_delta: delta, metrics: m, min_depth_m: Math.min(...js.h), max_depth_m: Math.max(...js.h), wall_with_process_ms: performance.now() - begin };
  reference.push(row); if (delta > 1e-9) throw Error(`Go/JS parity threshold exceeded: ${delta}`);
}
console.log(`REFERENCE_PARITY: ${reference.length} configurations`);
for (const cells of [32, 96, 512]) for (const dt_max of [.01, .03, .12]) for (const precision of ['f64', 'f32-state']) {
  rows.push({ axis: 'grid-dt-precision', ...slim(await run({ ...base, cells }, { dt_max, precision })) });
}
for (const cfl of [.2, .8, 1.2]) for (const precision of ['f64', 'f32-state']) rows.push({ axis: 'cfl-stress', ...slim(await run(base, { dt_max: .4, cfl, precision })) });
for (const cells of [96, 512]) for (const [inflow_m2_s, tide_m, roughness] of [[.05,-.4,.08],[2.5,.4,.01],[.05,.4,.01],[2.5,-.4,.08]]) for (const precision of ['f64', 'f32-state']) {
  rows.push({ axis: 'boundary-extreme', ...slim(await run({ ...base, cells, inflow_m2_s, tide_m, roughness }, { precision })) });
}
for (const cells of [96,512]) for (const forcing of ['inlet-pulse','tide-oscillation']) for (const precision of ['f64','f32-state']) rows.push({ axis: 'dynamic-boundary', ...slim(await run({ ...base, cells }, { forcing, precision })) });
for (const dt_max of [.3,1]) rows.push({ axis: 'unsafe-fixed-step', ...slim(await run({ ...base, cells: 512 }, { dt_max, time_mode: 'fixed' }, 3)) });
rows.push({ axis: 'broken-interface-negative', ...slim(await run(base, { partitions: 4, organization: 'partitioned-serial', fault: 'broken-interface' }, 3)) });
console.log(`STABILITY: ${rows.length} retained cases`);
for (const cells of [96,512]) {
  const expected = await run({ ...base, cells });
  const plans = [1,2,4,8].flatMap(partitions => (partitions === 1 ? ['monolithic'] : ['partitioned-serial','partitioned-workers']).map(organization => ({ partitions, organization })));
  for (const plan of plans) await run({ ...base, cells }, plan); // one unmeasured warm-up per configuration
  for (let repetition = 0; repetition < 3; repetition++) for (let i = 0; i < plans.length; i++) {
    const { partitions, organization } = plans[(i + repetition * 2) % plans.length];
    const r = await run({ ...base, cells }, { partitions, organization });
    const identical = r.checkpoint_sha256 === expected.checkpoint_sha256;
    partition.push({ repetition, identical_to_monolithic: identical, ...slim(r) });
    if (!identical || r.status !== 'finite') throw Error('Partition changed physical state');
  }
}
const median = values => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const costGroups = [...new Set(partition.map(r=>`${r.config.cells}/${r.options.organization}/${r.options.partitions}`))].map(key => {
  const group = partition.filter(r=>`${r.config.cells}/${r.options.organization}/${r.options.partitions}`===key), a=group[0];
  return { cells:a.config.cells, organization:a.options.organization, partitions:a.options.partitions, interfaces:a.options.partitions-1,
    setup_median_ms:median(group.map(r=>r.setup_ms)), advance_median_ms:median(group.map(r=>r.advance_ms)), total_median_ms:median(group.map(r=>r.total_ms)), repetitions:group.length,
    full_state_equivalent:group.every(r=>r.identical_to_monolithic), synchronization_barriers:a.receipt.barriers };
});
const fine = await run(base, { dt_max:.0025, cfl:.2 }); const refinement=[];
for(const dt_max of [.01,.03,.12]) { const r=await run(base,{dt_max,cfl:.39});const err=r.h.map((v,i)=>Math.abs(v-fine.h[i]));refinement.push({dt_max,max_depth_delta_to_refined_dt:Math.max(...err),mean_depth_delta_to_refined_dt:err.reduce((a,b)=>a+b,0)/err.length}); }
const stable64=rows.filter(r=>r.status==='finite'&&r.options.precision==='f64'&&r.options.fault==='none'&&r.options.time_mode==='adaptive'&&r.options.cfl<=.39);
if(stable64.some(r=>Math.abs(r.metrics.mass_residual_m2)>1e-8||r.metrics.min_depth_m<.02))throw Error('Float64 conservative envelope violated');
const broken=rows.find(r=>r.axis==='broken-interface-negative');if(broken.status==='finite'&&Math.abs(broken.metrics.mass_residual_m2)<=1e-6)throw Error('Broken-flux negative control did not discriminate');
const report={schema:'ecf-m3-r1-study/v1',baseline_commit:'471ae0b58b8c7a439fdd4ceceb6ca8fd538b265c',kernel_sha256:KERNEL_SHA,
  environment:{os:os.platform(),release:os.release(),arch:os.arch(),node:process.version,cpu_model:os.cpus()[0]?.model,logical_processors:os.cpus().length},
  scope:'1D river with ghost-state waterfall inlet and tailwater ocean boundary; not a 2D/3D waterfall/ocean solution.',
  reference_parity:reference,stability:rows,partition_trials:partition,cost_groups:costGroups,time_refinement:refinement,
  counts:{reference:reference.length,stability:rows.length,partition_trials:partition.length,unmeasured_partition_warmups:14},benchmark_design:{repetitions:3,order:'rotating configuration order',warmups_per_configuration:1,scope:'single-host pilot; no statistical scaling guarantee'},
  source_hashes:Object.fromEntries(await Promise.all(['solver.mjs','numerics.mjs','partition-worker.mjs','worker.mjs','study.mjs','solver.test.mjs','../../examples/fluid/fluid-core.js','../../internal/fluid/solver.go'].map(async name=>[name,digest((await readFile(path.join(here,name),'utf8')).replace(/\r\n?/g,'\n'))]))) };
await writeFile(path.join(results,'study.json'),JSON.stringify(report,null,2)+'\n');
await writeFile(path.join(results,'costs.csv'),['cells,organization,partitions,interfaces,setup_median_ms,advance_median_ms,total_median_ms',...costGroups.map(r=>[r.cells,r.organization,r.partitions,r.interfaces,r.setup_median_ms,r.advance_median_ms,r.total_median_ms].join(','))].join('\n')+'\n');
console.log(JSON.stringify({counts:report.counts,kernel_sha256:KERNEL_SHA,stable64_max_mass_residual:Math.max(...stable64.map(r=>Math.abs(r.metrics.mass_residual_m2))),numerical_refusals:rows.filter(r=>r.status!=='finite').length,cost_groups:costGroups}));
