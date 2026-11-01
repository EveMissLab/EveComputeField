// Optional, unprofiled synthetic comparison: baseline creation and all branch work charged.
// No performance promotion from this script without independent host tests.
import {ConeMemoryField,fullConeStep} from './cone-memory.mjs';
import {performance} from 'node:perf_hooks';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import os from 'node:os';

const cfg={width:64,height:64,horizon:5,branches:4,repeats:3,tileCells:64,
  threshold:.35,out:null};
const opts=process.argv.slice(2);
for(let i=0;i<opts.length;i+=2){
  const k=opts[i],v=opts[i+1];if(!v)throw Error('option requires value');
  const map={'--width':'width','--height':'height','--horizon':'horizon',
    '--branches':'branches','--repeats':'repeats','--tile-cells':'tileCells',
    '--threshold':'threshold','--out':'out'};
  if(!Object.hasOwn(map,k))throw Error(`unknown option ${k}`);
  cfg[map[k]]=k==='--out'?v:Number(v);
}
for(const [k,min,max] of [['width',4,128],['height',4,128],['horizon',1,12],
  ['branches',1,8],['repeats',1,50],['tileCells',4,4096]])
  if(!Number.isSafeInteger(cfg[k])||cfg[k]<min||cfg[k]>max)throw Error(`invalid ${k}`);
if(!Number.isFinite(cfg.threshold)||cfg.threshold<=0||cfg.threshold>1)throw Error('invalid threshold');
const seed=(length,s)=>{const a=Buffer.alloc(length);let x=(s*2654435761)>>>0;
  for(let i=0;i<length;i++){x^=x<<13;x^=x>>>17;x^=x<<5;a[i]=(x>>>0)%4===0?1:0;}return a;};
const records=[];
for(let rep=0;rep<cfg.repeats;rep++){
  const initial=seed(cfg.width*cfg.height,rep+11);
  const branches=Array.from({length:cfg.branches},(_,b)=>Array.from({length:cfg.horizon},(_,t)=>
    t===0?{kind:'pulse',cells:[(b*179+rep*7+37)%initial.length]}:{kind:'inertial'}));
  // Alternate measurement arm order for coarse timing-bias control.
  const runFull=()=>{
    const start=performance.now(),finals=[];
    for(const events of branches){let state=Buffer.from(initial);
      for(const e of events)state=fullConeStep(state,cfg.width,cfg.height,e);
      finals.push(state);
    }return {elapsed_ms:performance.now()-start,finals};
  };
  const runCone=()=>{
    const start=performance.now(),f=new ConeMemoryField({fieldId:'benchmark',width:cfg.width,
      height:cfg.height,initial,horizon:cfg.horizon,tileCells:cfg.tileCells,
      threshold:cfg.threshold,maxBranches:cfg.branches});
    const constructed=performance.now();
    try{
      branches.forEach((events,b)=>f.predict(`branch${b}`,events));
      const work=f.computeBudget(cfg.branches*cfg.horizon),staged=performance.now();
      const before=f.stats,finals=branches.map((_,b)=>f.inspect(`branch${b}`,cfg.horizon));
      const materialized=performance.now();
      const committed=f.commit(branches[0][0]);
      return {elapsed_ms:performance.now()-start,construct_ms:constructed-start,
        stage_ms:staged-constructed,verify_materialize_ms:materialized-staged,
        committed_reused:committed.reused,work:work.length,finals,stats:before};
    }finally{f.close();}
  };
  const first=rep%2===0?runFull():runCone();
  const second=rep%2===0?runCone():runFull();
  const full=rep%2===0?first:second,cone=rep%2===0?second:first;
  if(full.finals.some((f,i)=>!f.equals(cone.finals[i])))throw Error('independent oracle byte mismatch');
  records.push({trial:rep+1,full_branch_recompute_ms:full.elapsed_ms,
    cone_setup_stage_commit_and_materialize_ms:cone.elapsed_ms,
    cone_baseline_creation_ms:cone.construct_ms,cone_stage_ms:cone.stage_ms,
    cone_check_materialization_ms:cone.verify_materialize_ms,
    full_cell_evaluations:cfg.width*cfg.height*cfg.horizon*cfg.branches,
    cone_baseline_cell_evaluations:cone.stats.baseline_cells,
    cone_candidate_cell_evaluations:cone.stats.candidate_cells,
    cone_active_mapped_bytes:cone.stats.region_bytes,
    fully_equal:true,committed_candidate_reused:cone.committed_reused});
}
const report={schema:'ecf-m5p1-cone-memory-study/v1',status:'synthetic exploratory; not calibrated to physics or general hardware',
  host:{platform:process.platform,node:process.version,cpu:os.cpus()[0]?.model,logical_cpus:os.cpus().length},
  config:{...cfg,out:undefined},metric_scope:{full:'complete sequential branch recomputations',
    cone:'baseline construction + branch staging + final readback + one authorized commit; NOT an identical API workload to full arm',
    warning:'Do not claim wall-time speedup without matched end-to-end obligations, repeated runs and external hardware acceptance'},
  records};
const json=JSON.stringify(report,null,2)+'\n';
if(cfg.out)writeFileSync(resolve(cfg.out),json,{flag:'wx',encoding:'utf8'});
console.log(json);
