import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { ResearchSolver, KERNEL_SHA } from './solver.mjs';
import { originFor } from '../runtime-config.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(here,'../..'),out=path.join(here,'results');await mkdir(out,{recursive:true});
const token=(await readFile(path.join(repo,'.evefield-local/control.token'),'utf8')).trim(),headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
async function api(port,method,route,body){const response=await fetch(originFor(port)+route,{method,redirect:'error',headers,body:body===undefined?undefined:JSON.stringify(body)});const text=await response.text();if(!response.ok)throw Error(`HTTP ${response.status}: ${text}`);return text?JSON.parse(text):null;}
const field=(method,route,body)=>api(8765,method,route,body),hot=(method,route,body)=>api(8766,method,route,body);
const reportPath=path.join(out,'resident-study.json');
async function main(){
if(process.argv.includes('--verify-restart')){
  const report=JSON.parse(await readFile(reportPath,'utf8'));if(report.restart_verified){console.log('Resident restart already verified; no duplicate advance.');return;}
  for(const id of report.resident_field_ids){const r=await hot('POST','/v1/resident',{id,restore:true});assert.equal(r.state_sha256,report.final_common_state_sha256);}
  const id=report.resident_field_ids[0],next=await hot('POST',`/v1/resident/${id}/advance`,{steps:80});
  const direct=new ResearchSolver();try{direct.advanceSteps(1680);assert.equal(next.state_sha256,direct.checkpoint().integrity_sha256);}finally{await direct.close();}
  const saved=await hot('POST',`/v1/resident/${id}/checkpoint`,{});assert.equal(saved.saved,true);
  report.restart_verified=true;report.post_restart={id,steps:next.metrics.steps,time_s:next.metrics.time_s,worker_pool_creations:next.worker_pool_creations,buffers_reused:next.buffers_reused,state_sha256:next.state_sha256};
  await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');await writeFile(path.join(here,'.runtime/current-resident.json'),JSON.stringify({id,endpoint:'http://127.0.0.1:8766',steps:next.metrics.steps},null,2));console.log(JSON.stringify(report.post_restart));return;
}
const tag=Date.now().toString(36),ids=[`m3-cold-${tag}`,`m3-ram-${tag}`,`m3-saved-${tag}`],spec=JSON.parse(await readFile(path.join(repo,'examples/local.json'),'utf8'));
for(const id of ids)await field('POST','/v1/fields',{...spec,field_id:id,unit_count:720});
const options={partitions:4,organization:'partitioned-workers'},cold=[];let prior;
for(let i=0;i<20;i++){
  const request={schema:'ecf-fluid-advance/v1',options,advance_steps:80};if(prior){request.checkpoint=prior.checkpoint;request.organization_history=prior.organization_history;}
  const start=performance.now(),r=await field('POST',`/v1/fields/${ids[0]}/invoke/fluid-research`,{input:JSON.stringify(request),save_domain:'continuity',save_key:'cold_latest'});assert(r.saved);prior=JSON.parse(r.stdout);
  cold.push({elapsed_ms:performance.now()-start,setup_ms:prior.timing.setup_ms,compute_ms:prior.timing.advance_ms,steps:prior.metrics.steps});
}
const modes=[];
for(const [index,checkpointEach]of [[1,false],[2,true]]){
  const id=ids[index],baseline=await hot('GET','/v1/resident'),start=performance.now(),created=await hot('POST','/v1/resident',{id,options}),createMs=performance.now()-start,samples=[];
  for(let i=0;i<20;i++){
    const begin=performance.now(),r=await hot('POST',`/v1/resident/${id}/advance`,{steps:80});let save=null;if(checkpointEach)save=await hot('POST',`/v1/resident/${id}/checkpoint`,{});
    assert(r.buffers_reused&&r.original_pool_reused);assert.equal(r.worker_pool_creations,1);
    samples.push({elapsed_ms:performance.now()-begin,compute_ms:r.compute_ms,total_with_audit_ms:r.total_with_audit_ms,save_ms:save?.elapsed_ms??0,rss_bytes:r.rss_bytes,steps:r.metrics.steps,worker_pool_creations:r.worker_pool_creations,buffers_reused:r.buffers_reused});
  }
  const final=await hot('GET',`/v1/resident/${id}`);assert.equal(final.state_sha256,prior.checkpoint.integrity_sha256);const saved=await hot('POST',`/v1/resident/${id}/checkpoint`,{});assert(saved.saved);
  modes.push({mode:checkpointEach?'resident-save-each-call':'resident-RAM-save-at-end',id,create_ms:createMs,rss_before_create_bytes:baseline.rss_bytes,initial_rss_bytes:created.rss_bytes,observed_peak_rss_bytes:Math.max(created.rss_bytes,...samples.map(s=>s.rss_bytes)),observed_peak_delta_bytes:Math.max(created.rss_bytes,...samples.map(s=>s.rss_bytes))-baseline.rss_bytes,samples,final_saved_bytes:saved.bytes});
}
const sorted=v=>[...v].sort((a,b)=>a-b),stats=v=>{const s=sorted(v);return{median_ms:s[Math.floor(s.length/2)],p95_ms:s[Math.ceil(s.length*.95)-1],min_ms:s[0],max_ms:s.at(-1)}};
const summary=[{mode:'cold-process-save-each-call',calls:20,...stats(cold.map(r=>r.elapsed_ms)),setup_median_ms:stats(cold.map(r=>r.setup_ms)).median_ms},...modes.map(m=>({mode:m.mode,calls:m.samples.length,...stats(m.samples.map(r=>r.elapsed_ms)),create_ms:m.create_ms,worker_pool_creations:1,all_buffers_and_pool_reused:m.samples.every(r=>r.buffers_reused&&r.worker_pool_creations===1),rss_after_bytes:m.samples.at(-1).rss_bytes}))];
const report={schema:'ecf-m3-r1-residency-study/v1',kernel_sha256:KERNEL_SHA,cold_field_id:ids[0],resident_field_ids:ids.slice(1),cold_samples:cold,resident_modes:modes,summary,
  steps_per_call:80,simulated_steps_per_mode:1600,final_common_state_sha256:prior.checkpoint.integrity_sha256,all_modes_exact_state_equivalence:true,restart_verified:false,
  scope:'20 serial continuation calls, same 96-cell float64 physics and four cell-update workers. Saved-each modes match checkpoint frequency; RAM-only mode deliberately defers full snapshots. Timings are single-host pilot end-to-end latency, not universal speed claims.'};
await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({summary,all_modes_exact_state_equivalence:true}));
}
await main();
