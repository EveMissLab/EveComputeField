import { NetworkSolver,makeNetwork,KERNEL_SHA } from './solver.mjs';import { performance } from 'node:perf_hooks';import { mkdir,writeFile } from 'node:fs/promises';import path from 'node:path';import { fileURLToPath } from 'node:url';import assert from 'node:assert/strict';import os from 'node:os';
const out=path.join(path.dirname(fileURLToPath(import.meta.url)),'results');await mkdir(out,{recursive:true});
const rows=[],sizes=process.argv.includes('--large')?[262144,1048576]:[1024,4096,16384,65536];
for(const total of sizes){const graph=makeNetwork({trunk:2,tributaries:2,cells:total/4}),a=new NetworkSolver(graph),cp=a.capture();a.advanceSteps(32);a.load(cp);
  try{for(const workers of[2,4,8].filter(p=>p<=a.layout.tiles.length)){const b=new NetworkSolver(graph,{workers});try{b.advanceSteps(32);b.load(cp);const pairs=[],cpu=[];for(let rep=0;rep<6;rep++){
      const times=[];for(const who of(rep%2?[1,0]:[0,1])){const s=who?b:a;s.load(cp);const c=process.cpuUsage(),start=performance.now();s.advanceSteps(16);times[who]=performance.now()-start;const used=process.cpuUsage(c);cpu[who]=(used.user+used.system)/1000;}
      assert.equal(a.stateHash(),b.stateHash());pairs.push({serial_ms:times[0],parallel_ms:times[1],speedup:times[0]/times[1]});}
      const median=v=>[...v].sort((a,b)=>a-b)[Math.floor(v.length/2)],row={total_cells:total,reaches:4,storage_nodes:5,workers,pairs,median_speedup:median(pairs.map(p=>p.speedup)),serial_median_ms:median(pairs.map(p=>p.serial_ms)),parallel_median_ms:median(pairs.map(p=>p.parallel_ms)),cpu_ms_last_pair:cpu,exact:true,organization:b.organization(),metrics:b.measure()};rows.push(row);console.log(JSON.stringify({cells:total,workers,speedup:row.median_speedup,serial:row.serial_median_ms,parallel:row.parallel_median_ms}));
    }finally{await b.close();}}
  }finally{await a.close();}}
await writeFile(path.join(out,process.argv.includes('--large')?'pilot-large.json':'pilot.json'),JSON.stringify({kernel_sha256:KERNEL_SHA,host:{cpu:os.cpus()[0].model,logical_cpus:os.cpus().length,node:process.version},warmup_steps:32,steps_per_call:16,paired_reps:6,exploratory_only:true,rows},null,2)+'\n');
