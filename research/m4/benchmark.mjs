// Explicit local benchmark only; does not write research claims to the repo.
// Node 24 measured baseline is the reference; use a current Node release.
import {NetworkSolver,makeNetwork,KERNEL_SHA,digest} from '../m3-r3/solver.mjs';
import {createPlacement,selectPlacement,applyPlacement} from './planner.mjs';
import {observeR3Banks} from './memory.mjs';
import os from 'node:os';
import {performance} from 'node:perf_hooks';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';

function parse(argv) {
  const opts={cells:2048,units:720,workers:[2,4],pairs:4,steps:16,calls:32,out:null};
  for(let i=0;i<argv.length;i++){
    const key=argv[i];if(!key.startsWith('--'))throw Error('expected --option');
    const value=argv[++i];if(value===undefined)throw Error(`missing value ${key}`);
    if(key==='--workers')opts.workers=value.split(',').map(Number);
    else if(key==='--cells')opts.cells=Number(value);
    else if(key==='--units')opts.units=Number(value);
    else if(key==='--pairs')opts.pairs=Number(value);
    else if(key==='--steps')opts.steps=Number(value);
    else if(key==='--calls')opts.calls=Number(value);
    else if(key==='--out')opts.out=value;
    else throw Error('unknown option');
  }
  if(!Number.isSafeInteger(opts.cells)||opts.cells%4||opts.cells<256||opts.cells>262144||
     !Number.isSafeInteger(opts.units)||opts.units<1||opts.units>65536||
     !Number.isSafeInteger(opts.pairs)||opts.pairs<2||opts.pairs>50||
     !Number.isSafeInteger(opts.steps)||opts.steps<1||opts.steps>128||
     !Number.isSafeInteger(opts.calls)||opts.calls<1||opts.calls>1000000||
     opts.workers.some(x=>![2,4,8].includes(x))||new Set(opts.workers).size!==opts.workers.length)
    throw Error('invalid bounded benchmark configuration');
  return opts;
}
const args=parse(process.argv.slice(2)), graph=makeNetwork({trunk:2,tributaries:2,cells:args.cells/4,pulse:true,tide:.2}),
  a=new NetworkSolver(graph),cp=a.capture(),arms=[],host={cpu:os.cpus()[0]?.model||'unknown',
  logical_cpus:os.cpus().length,platform:process.platform,node:process.version};
try {
  for(const workers of args.workers){
    const start=performance.now(),b=new NetworkSolver(graph,{workers,mode:'fused',exchange:'direct'}),setup=performance.now()-start;
    try {
      // Warm both arms once outside timed calls. Load the same checkpoint every pair.
      a.advanceSteps(args.steps);b.advanceSteps(args.steps);
      const pairs=[];
      for(let block=0;block<2;block++)for(let rep=0;rep<args.pairs;rep++){
        const times=[];
        for(const who of ((block+rep)%2?[1,0]:[0,1])){
          const s=who?b:a;s.load(cp);
          const t=performance.now();s.advanceSteps(args.steps);times[who]=performance.now()-t;
        }
        pairs.push({block,serial_ms:times[0],parallel_ms:times[1],identical_state:a.stateHash()===b.stateHash()});
        if(!pairs[pairs.length-1].identical_state)throw Error('M4 physical parity failed; stop benchmarking');
      }
      arms.push({workers,mode:'fused',exchange:'direct',setup_ms:setup,pairs});
    } finally {await b.close();}
  }
  const evidence={schema:'ecf-m4-matched-probes/v1',cells:a.layout.cells,tile_count:a.layout.tiles.length,
    graph_sha256:digest(graph),kernel_sha256:KERNEL_SHA,host,steps_per_call:args.steps,arms};
  const decision=selectPlacement({logicalUnits:args.units,layout:a.layout,evidence,
    graphSha256:evidence.graph_sha256,kernelSha256:KERNEL_SHA,expectedHost:host,expectedCalls:args.calls,
    minPairs:args.pairs*2});
  const before=a.stateHash(),memory=observeR3Banks(a,{fieldId:'m4-local-benchmark'});
  const chosen=createPlacement({fieldId:'m4-local-benchmark',logicalUnits:args.units,layout:a.layout,
    workers:decision.placement.workers,mode:decision.placement.mode,exchange:decision.placement.exchange});
  const receipt=await applyPlacement(a,chosen);
  if(a.stateHash()!==before)throw Error('reconfiguration damaged physical state');
  const report={schema:'ecf-m4-single-host-study/v1',scope:'exploratory only; process startup, saving and rendering excluded from paired hot-call timings',
    host,config:args,kernel_sha256:KERNEL_SHA,graph_sha256:evidence.graph_sha256,
    measurement:evidence,selection:{...decision,placement:chosen},reorganization_receipt:receipt,
    memory_domain:memory.domain.describe(),active_bank:memory.active().bank};
  const output=JSON.stringify(report,null,2)+'\n';
  if(args.out){await writeFile(path.resolve(args.out),output,{flag:'wx'});}
  console.log(output);
} finally {await a.close();}
