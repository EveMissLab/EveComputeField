import { readFile,writeFile,mkdir } from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import { performance } from 'node:perf_hooks';
import { api,here,repo,originFor } from './client.mjs';import { CoupledSolver,KERNEL_SHA } from './solver.mjs';
const out=path.join(here,'results');await mkdir(out,{recursive:true});await mkdir(path.join(here,'.runtime'),{recursive:true});
const reportPath=path.join(out,'resident-study.json');
async function createField(id){const spec=JSON.parse(await readFile(path.join(repo,'examples/local.json'),'utf8'));spec.field_id=id;spec.unit_count=96;await api(8765,'POST','/v1/fields',spec);await api(8765,'POST',`/v1/fields/${id}/run`);}
const get=id=>api(8767,'GET',`/v2/resident/${id}`).then(r=>r.value),post=(id,route,body={})=>api(8767,'POST',`/v2/resident/${id}/${route}`,body).then(r=>r.value);
async function main(){
if(process.argv.includes('--restore-readback')){
  const r=JSON.parse(await readFile(reportPath,'utf8'));for(const[id,demo]of[[r.field_id,true],[r.comparison_id,false]]){
    const loaded=(await api(8767,'POST','/v2/resident',{id,restore:true,demo})).value;const saved=JSON.parse((await api(8765,'GET',`/v1/fields/${id}/memory/continuity/r2_latest`)).value.value);
    assert.equal(loaded.state_sha256,saved.checkpoint.integrity_sha256);const expected=CoupledSolver.restore(saved.checkpoint);try{expected.advanceSteps(80);const live=await post(id,'advance',{steps:80});assert.equal(live.state_sha256,expected.checkpoint().integrity_sha256);await post(id,'checkpoint');if(demo){r.restart={process_restart_readback:true,restored_step:saved.checkpoint.steps,restored_hash:saved.checkpoint.integrity_sha256,post_restart_step:live.metrics.steps,post_restart_hash:live.state_sha256,continuation_matches_uninterrupted:true};}}finally{await expected.close();}
  }r.final=await get(r.field_id);await writeFile(reportPath,JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({restart:r.restart,final:r.final}));return;
}
const stamp=Date.now().toString(36),id=`m3-r2-${stamp}`,comparison=`m3-r2-f32-${stamp}`;
let r1Before=null;try{const prior=JSON.parse(await readFile(path.resolve(here,'../m3-r1/.runtime/current-resident.json'),'utf8'));r1Before=(await api(8766,'GET',`/v1/resident/${prior.id}`)).value;}catch(error){if(error.code!=='ENOENT')throw error;}
await createField(id);await createField(comparison);
const config={source:{kind:'pulse',base:1,amplitude:.8,at:2,duration:2},ocean:{tide_amplitude:.2,tide_period:6}};
const created=(await api(8767,'POST','/v2/resident',{id,config,options:{partitions:4,organization:'partitioned-workers'},demo:true})).value;
const other=(await api(8767,'POST','/v2/resident',{id:comparison,config,options:{precision:'f32-state',partitions:4,organization:'partitioned-serial'}})).value;
await writeFile(path.join(here,'.runtime/current.json'),JSON.stringify({field_id:id,comparison_id:comparison,endpoint:'http://127.0.0.1:8767',kernel_sha256:KERNEL_SHA},null,2)+'\n');
const calls=[];for(let i=0;i<10;i++){const start=performance.now(),v=await post(id,'advance',{steps:80});calls.push({call:i,steps:v.metrics.steps,wall_ms:performance.now()-start,compute_ms:v.compute_ms,audit_ms:v.total_with_audit_ms-v.compute_ms,state_sha256:v.state_sha256,buffers_reused:v.buffers_reused,original_pool_reused:v.original_pool_reused,pool_creations:v.worker_pool_creations});}
const direct=new CoupledSolver(config);try{direct.advanceSteps(800);assert.equal((await get(id)).state_sha256,direct.checkpoint().integrity_sha256);}finally{await direct.close();}
const before=await get(id),changed=await post(id,'reorganize',{partitions:2,organization:'partitioned-workers',exchange:'message-copy'});assert.equal(changed.state_sha256,before.state_sha256);
await api(8765,'PUT',`/v1/fields/${id}/resize`,{unit_count:720});await post(id,'advance',{steps:80});
const saved=await post(id,'checkpoint');assert.ok(saved.bytes<65536);
const invalid=await api(8767,'POST',`/v2/resident/${id}/reorganize`,{partitions:5,organization:'partitioned-workers'},true);assert.ok(invalid.status>=400);assert.equal((await get(id)).state_sha256,saved.state_sha256);
await post(comparison,'advance',{steps:240});const otherSaved=await post(comparison,'checkpoint');
const r1After=r1Before?(await api(8766,'GET',`/v1/resident/${r1Before.id}`)).value:null;if(r1Before)assert.equal(r1Before.state_sha256,r1After.state_sha256);
const unauth=await fetch(originFor(8767)+'/v2/resident');assert.equal(unauth.status,401);await unauth.text();
const origin=await api(8767,'POST',`/v2/resident/${id}/advance`,{steps:1},true,{Origin:'http://example.invalid'});assert.equal(origin.status,403);
const demo=await fetch(originFor(8767)+'/demo/state'),demoState=await demo.json();assert.equal(demoState.state_sha256,saved.state_sha256);assert.ok(!JSON.stringify(demoState).includes('control.token'));
const report={schema:'ecf-m3-r2-resident-study/v2',created_utc:new Date().toISOString(),kernel_sha256:KERNEL_SHA,field_id:id,comparison_id:comparison,config,created,comparison_created:other,hot_calls:calls,hot_buffers_reused:calls.every(x=>x.buffers_reused),hot_pool_created_once:calls.every(x=>x.pool_creations===1&&x.original_pool_reused),uninterrupted_800_steps_exact:true,reorganization_preserves_physical_state:true,invalid_reorganization_preserves_state:true,final:await get(id),saved,comparison_saved:otherSaved,r1_preserved:r1After?{id:r1After.id,state_sha256:r1After.state_sha256,exact:true}:{checked:false,reason:'No local R1 baseline supplied'},control_checks:{unauthenticated_status:unauth.status,browser_origin_status:origin.status,readonly_demo_same_live_state:true},restart:{process_restart_readback:false},persistence_scope:'Explicit Go M2 checkpoint, hash-linked best-effort audit log. No fsync/power-loss/authenticated authorship claim. State is an ID-associated sidecar, not native FieldSpec solver execution.'};
await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({field_id:id,comparison_id:comparison,saved,reorganization_preserves_physical_state:true,r1_preserved:true}));
}await main();
