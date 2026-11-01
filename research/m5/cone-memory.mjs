// M5-P1: memory-resident multi-ordinal finite-influence reference executor.
// Independently authored MIT-sidecar; not the pending-license ODTS source.
// Only the declared deterministic Moore-radius-1 binary CA can use local cones.
// The existing R3 fluid PDE remains on its conservative full-computation path.
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {VirtualMemoryDomain} from '../m4/memory.mjs';

const ID=/^[A-Za-z0-9_.-]{1,64}$/;
const integer=(x,low,high,label)=>{if(!Number.isSafeInteger(x)||x<low||x>high)throw Error(`invalid ${label}`);return x;};
const digest=x=>createHash('sha256').update(x).digest('hex');
const sig=x=>digest(Buffer.from(JSON.stringify(x),'utf8'));
const key=(branch,ordinal)=>`${branch}@${ordinal}`;
const even=(a,b)=>a===b;
const compareAscii=(a,b)=>a<b?-1:a>b?1:0;

export function normalizeConeEvent(event,size){
  if(!event||typeof event!=='object'||Array.isArray(event)||
     !['inertial','pulse','global-invert'].includes(event.kind))throw Error('unsupported event; conservative policy required');
  if(event.kind==='pulse'){
    if(Object.keys(event).sort().join(',')!=='cells,kind'||!Array.isArray(event.cells)||
       !event.cells.length||event.cells.length>Math.min(size,1024))throw Error('invalid pulse footprint');
    const cells=[...event.cells].sort((a,b)=>a-b);
    if(cells.some((v,i)=>!Number.isInteger(v)||v<0||v>=size||i>0&&cells[i-1]===v))throw Error('invalid pulse coordinates');
    return Object.freeze({kind:'pulse',cells:Object.freeze(cells)});
  }
  if(Object.keys(event).join(',')!=='kind')throw Error('unexpected global/inertial event fields');
  return Object.freeze({kind:event.kind});
}
const eventSignature=e=>sig(e);
const eventSet=e=>new Set(e.cells||[]);
const afterEvent=(value,event,index,flips)=>event.kind==='global-invert'?1-value:
  (event.kind==='pulse'&&flips.has(index)?1-value:value);
export function lifeCell(read,width,height,index){
  const x=index%width,y=Math.floor(index/width);let neighbours=0;
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    if(dx===0&&dy===0)continue;
    const xx=(x+dx+width)%width,yy=(y+dy+height)%height;
    neighbours+=read(yy*width+xx);
  }
  const v=read(index);return v?(neighbours===2||neighbours===3?1:0):(neighbours===3?1:0);
}
export function fullConeStep(previous,width,height,rawEvent){
  const size=width*height;if(previous.length!==size)throw Error('wrong input grid length');
  const event=normalizeConeEvent(rawEvent,size),flips=eventSet(event),out=Buffer.alloc(size);
  for(let i=0;i<size;i++)out[i]=afterEvent(lifeCell(j=>previous[j],width,height,i),event,i,flips);
  return out;
}
function widen(changed,width,height){
  const ret=new Set();for(const i of changed){const x=i%width,y=Math.floor(i/width);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)ret.add(((y+dy+height)%height)*width+((x+dx+width)%width));}
  return ret;
}
const rawState = initial=>{
  if(!Buffer.isBuffer(initial)&&!(initial instanceof Uint8Array))throw Error('state requires bytes');
  const input=Buffer.from(initial);if(input.some(v=>v!==0&&v!==1))throw Error('state must be binary');return input;
};

export class ConeMemoryField {
  #region;#frames=new Set();#baseline=[];#branches=new Map();#candidates=new Map();#lineages=new Map();
  #world;#model;#head;#history=[];#blocked=false;#busy=false;#counter=0;
  #statistics={baseline_cells:0,baseline_ms:0,candidate_cells:0,full_fallbacks:0,
    sparse_frames:0,alias_frames:0,dense_frames:0,reused_tiles:0,oracle_cells:0,commits_reused:0,
    commits_fallback:0,released_bytes:0,stage_ms:0};
  constructor({fieldId='depth-cone',width=32,height=32,initial,horizon=4,
    baselineEvents=null,tileCells=64,threshold=0.35,maxBranches=8,
    quotaBytes=64*1024*1024,worldRevision='world-v1',modelRevision='life-moore-r1'}={}){
    if(!ID.test(fieldId)||!ID.test(worldRevision)||modelRevision!=='life-moore-r1')
      throw Error('invalid field/model identity');
    integer(width,4,256,'width');integer(height,4,256,'height');integer(horizon,1,16,'horizon');
    integer(maxBranches,1,32,'branch budget');integer(tileCells,4,4096,'tile size');
    if(typeof threshold!=='number'||!Number.isFinite(threshold)||threshold<=0||threshold>1)
      throw Error('invalid sparse/dense threshold');
    const size=width*height,seed=rawState(initial);
    if(seed.length!==size)throw Error('invalid initial extent');
    this.fieldId=fieldId;this.width=width;this.height=height;this.cells=size;
    this.horizon=horizon;this.tileCells=tileCells;this.threshold=threshold;
    this.maxBranches=maxBranches;this.#world=worldRevision;this.#model=modelRevision;
    if(size*(horizon+1)>quotaBytes)throw Error('baseline exceeds memory-domain quota');
    this.#region=new VirtualMemoryDomain({fieldId,domainId:'depth-cone',quotaBytes});
    const events=baselineEvents??Array.from({length:horizon},()=>({kind:'inertial'}));
    if(!Array.isArray(events)||events.length!==horizon)throw Error('baseline event horizon mismatch');
    this.baselineEvents=Object.freeze(events.map(e=>normalizeConeEvent(e,size)));
    const start=performance.now();
    let current=seed;
    for(let t=0;t<=horizon;t++){
      if(t>0){current=fullConeStep(current,width,height,this.baselineEvents[t-1]);
        this.#statistics.baseline_cells+=size;}
      const frame=this.#dense(current,t,'baseline');this.#baseline.push(frame);
    }
    this.#statistics.baseline_ms=performance.now()-start;
    this.#head=this.#baseline[0];this.#history=[{ordinal:0,event:null,frame:this.#head}];
  }
  get memory(){return this.#region.describe();}
  get stats(){return {...this.#statistics,ordinal:this.#head.ordinal,branches:this.#branches.size,
    pending_frames:this.#candidates.size,region_bytes:this.#region.describe().mapped_bytes};}
  get head(){return {ordinal:this.#head.ordinal,content_digest:this.#head.digest,
    world_revision:this.#world,model_revision:this.#model};}
  get blocked(){return this.#blocked;}
  #guard(){if(this.#busy||this.#blocked)throw Error(this.#blocked?'rebase required after authority/revision divergence':'field operation active');}
  #name(){this.#counter++;return `r${this.#counter}`;}
  #hashTiles(data){const hashes=[];for(let i=0;i<data.length;i+=this.tileCells)
    hashes.push(digest(data.subarray(i,Math.min(i+this.tileCells,data.length))));return hashes;}
  #root(hashes){return sig({schema:'ecf-m5-tile-content/v1',cells:this.cells,
    tile_cells:this.tileCells,sha256_by_tile:hashes});}
  #alloc(bytes){const name=this.#name(),handle=this.#region.allocate({name,type:'u8',elements:bytes.length});
    this.#region.view(handle,{write:true}).set(bytes);return {name,handle};}
  #dense(bytes,ordinal,authority){const region=this.#alloc(bytes);
    const tileDigests=this.#hashTiles(bytes);
    const f={ordinal,kind:'dense',authority,region,tiles:null,actual_diff:[],
      digest:this.#root(tileDigests),tileDigests,owned:[region],prepared_cells:bytes.length};
    this.#frames.add(f);return f;}
  #releaseFrame(frame){if(!this.#frames.delete(frame))return;
    for(const r of frame.owned){this.#statistics.released_bytes+=this.#region.release(r.name,
      {expectedGeneration:r.handle.generation,quiescent:true}).released_bytes;}}
  #keepGC(){const keep=new Set(this.#baseline);
    keep.add(this.#head);for(const f of this.#candidates.values())keep.add(f);
    for(const f of [...this.#frames])if(!keep.has(f))this.#releaseFrame(f);
  }
  #read(frame){
    if(frame.kind==='dense'){const v=this.#region.view(frame.region.handle);return index=>v[index];}
    const base=this.#region.view(this.#baseline[frame.ordinal].region.handle),tiles=new Map();
    for(const [tile,r] of frame.tiles)tiles.set(tile,this.#region.view(r.handle));
    return i=>{const t=Math.floor(i/this.tileCells),r=tiles.get(t);return r?r[i-t*this.tileCells]:base[i];};
  }
  #materialize(frame){const get=this.#read(frame),out=Buffer.alloc(this.cells);
    for(let i=0;i<this.cells;i++)out[i]=get(i);return out;}
  getCandidate(branch,ordinal){const k=key(branch,ordinal),f=this.#candidates.get(k);
    if(!f)return null;return {branch,ordinal,kind:f.kind,content_merkle_sha256:f.digest,
      lineage_digest:this.#lineages.get(k)?.lineage,changed_cells:f.actual_diff.length,regions:f.owned.length};}
  inspect(branch,ordinal){const f=this.#candidates.get(key(branch,ordinal));
    return f?this.#materialize(f):null;}
  readHead(){return this.#materialize(this.#head);}
  predict(branch,events,{parentBranch=null,forkDepth=1,priority=0}={}){
    this.#guard();if(!ID.test(branch)||this.#branches.has(branch)||this.#branches.size>=this.maxBranches||
       !Array.isArray(events)||!events.length||events.length>this.horizon||
       !Number.isSafeInteger(priority))throw Error('invalid prediction branch');
    integer(forkDepth,1,events.length,'fork depth');
    const seq=events.map(e=>normalizeConeEvent(e,this.cells)),start=0;
    if(parentBranch!==null){const p=this.#branches.get(parentBranch);
      if(!p||p.events.length<forkDepth-1)throw Error('unknown or insufficient parent prefix');
      for(let i=0;i<forkDepth-1;i++)if(eventSignature(p.events[i])!==eventSignature(seq[i]))
        throw Error('inherited prefix mismatch');
    }else if(forkDepth!==1)throw Error('orphan nonzero fork');
    for(let i=0;i<this.#head.ordinal;i++)if(eventSignature(seq[i])!==eventSignature(this.#history[i+1].event))
      throw Error('prediction differs from committed prefix');
    this.#branches.set(branch,{branch,parentBranch,forkDepth,priority,events:seq,start});
    return {branch,depth:seq.length,parent_branch:parentBranch,fork_depth:forkDepth};
  }
  #ready(){const items=[];
    for(const p of this.#branches.values()){
      for(let t=this.#head.ordinal+1;t<=p.events.length;t++){
        if(this.#candidates.has(key(p.branch,t)))continue;
        const parent=t-1===this.#head.ordinal?this.#head:this.#candidates.get(key(p.branch,t-1));
        if(!parent)break;
        if(p.parentBranch!==null&&t<p.forkDepth&&!this.#candidates.has(key(p.parentBranch,t)))break;
        items.push({branch:p.branch,ordinal:t,priority:p.priority,parent});break;
      }
    }
    return items.sort((a,b)=>b.ordinal-a.ordinal||b.priority-a.priority||compareAscii(a.branch,b.branch));
  }
  #computeFrame(previous,ordinal,event){
    const base=this.#baseline[ordinal],
      baselineEvent=this.baselineEvents[ordinal-1],start=performance.now();
    const global=event.kind==='global-invert'||baselineEvent.kind==='global-invert';
    const diff=new Set(previous.actual_diff),footprint=global?new Set():widen(diff,this.width,this.height);
    for(const i of baselineEvent.cells||[])footprint.add(i);
    for(const i of event.cells||[])footprint.add(i);
    const full=global||footprint.size>this.threshold*this.cells;
    const prev=this.#read(previous),reference=this.#region.view(base.region.handle),flips=eventSet(event);
    const changed=[],own=[],tiles=new Map();let candidateCells=0;
    try{
      if(full){const all=Buffer.alloc(this.cells);
        for(let i=0;i<this.cells;i++)all[i]=afterEvent(lifeCell(prev,this.width,this.height,i),event,i,flips);
        candidateCells=this.cells;
        for(let i=0;i<this.cells;i++)if(all[i]!==reference[i])changed.push(i);
        const f=this.#dense(all,ordinal,'candidate');f.actual_diff=changed;
        f.reason=global?'global-event':'coverage-fallback';f.prepared_cells=candidateCells;
        f.influence_cells=global?this.cells:footprint.size;f.dirty_tiles=f.tileDigests.length;
        this.#statistics.dense_frames++;this.#statistics.full_fallbacks++;
        this.#statistics.candidate_cells+=candidateCells;this.#statistics.stage_ms+=performance.now()-start;
        return f;
      }
      const differences=new Map();const affected=[...footprint].sort((a,b)=>a-b);
      for(const i of affected){const value=afterEvent(lifeCell(prev,this.width,this.height,i),event,i,flips);
        candidateCells++;
        if(value!==reference[i]){changed.push(i);differences.set(i,value);}}
      if(differences.size){
        const tileIds=[...new Set(changed.map(i=>Math.floor(i/this.tileCells)))].sort((a,b)=>a-b);
        for(const tile of tileIds){const startCell=tile*this.tileCells,
            endCell=Math.min(startCell+this.tileCells,this.cells),values=Buffer.from(reference.subarray(startCell,endCell));
          for(let i=startCell;i<endCell;i++)if(differences.has(i))values[i-startCell]=differences.get(i);
          const region=this.#alloc(values);own.push(region);tiles.set(tile,region);
        }
      }
      const tileDigests=[...base.tileDigests];for(const [t,r] of tiles)
        tileDigests[t]=digest(this.#region.view(r.handle));
      const f={ordinal,kind:'sparse',authority:'candidate',region:null,tiles,
        owned:own,actual_diff:changed,digest:this.#root(tileDigests),tileDigests,
        reason:'local-cone',prepared_cells:candidateCells,
        influence_cells:footprint.size,dirty_tiles:tiles.size};
      this.#frames.add(f);
      this.#statistics.sparse_frames++;this.#statistics.reused_tiles+=Math.ceil(this.cells/this.tileCells)-tiles.size;
      this.#statistics.candidate_cells+=candidateCells;this.#statistics.stage_ms+=performance.now()-start;
      return f;
    }catch(e){for(const r of own)this.#region.release(r.name,{expectedGeneration:r.handle.generation,quiescent:true});throw e;}
  }
  computeBudget(maxFrames){this.#guard();integer(maxFrames,0,100000,'compute budget');this.#busy=true;
    const work=[];
    try{for(let i=0;i<maxFrames;i++){
      const ready=this.#ready()[0];if(!ready)break;
      const plan=this.#branches.get(ready.branch),event=plan.events[ready.ordinal-1],
        inherited=plan.parentBranch&&ready.ordinal<plan.forkDepth?this.#candidates.get(key(plan.parentBranch,ready.ordinal)):null;
      let frame;
      if(inherited){frame=inherited;this.#statistics.alias_frames++;}
      else frame=this.#computeFrame(ready.parent,ready.ordinal,event);
      // Each branch has its own causal lineage even when the physical frame is shared.
      const lineage=sig({branch:ready.branch,parent_branch:plan.parentBranch,
        fork_depth:plan.forkDepth,ordinal:ready.ordinal,parent_digest:ready.parent.digest,
        content_digest:frame.digest,event,world:this.#world,model:this.#model});
      this.#candidates.set(key(ready.branch,ready.ordinal),frame);
      // Lineage is a property of the branch record; do not mutate a shared frame.
      this.#lineages.set(key(ready.branch,ready.ordinal),{lineage,parent_digest:ready.parent.digest});
      const evidence={branch:ready.branch,ordinal:ready.ordinal,
        relative_depth:ready.ordinal-this.#head.ordinal,kind:frame.kind,
        dependency:'exact Moore r=1; explicit bounded pulse footprint',
        parent_content_merkle_sha256:ready.parent.digest,
        evaluated_cells:inherited?0:frame.prepared_cells,
        influence_cells:inherited?0:frame.influence_cells,
        changed_cells:frame.actual_diff.length,
        allocated_bytes:inherited?0:frame.owned.reduce((n,r)=>n+r.handle.length,0),
        dirty_tiles:inherited?0:frame.dirty_tiles,
        content_merkle_sha256:frame.digest,lineage_digest:lineage,
        event_sha256:eventSignature(event),world_revision:this.#world,model_revision:this.#model,
        reason:inherited?'inherited-prefix':frame.reason};
      work.push({...evidence,receipt_sha256:sig(evidence)});
    }return work;
    }finally{this.#busy=false;}
  }
  commit(rawEvent,{verifyFull=false}={}){this.#guard();
    if(typeof verifyFull!=='boolean')throw Error('invalid verification policy');
    const event=normalizeConeEvent(rawEvent,this.cells),next=this.#head.ordinal+1;
    if(next>this.horizon)throw Error('bounded horizon exceeded; create new baseline');
    const matches=[...this.#branches.values()].filter(p=>{
      if(p.events.length<next||eventSignature(p.events[next-1])!==eventSignature(event))return false;
      for(let i=0;i<next-1;i++)if(eventSignature(p.events[i])!==
          eventSignature(this.#history[i+1].event))return false;
      const id=key(p.branch,next),lineage=this.#lineages.get(id);
      return this.#candidates.has(id)&&lineage?.parent_digest===this.#head.digest;
    });
    const chosen=matches.sort((a,b)=>b.priority-a.priority||compareAscii(a.branch,b.branch))[0];
    let frame,wasReused=false;
    if(chosen&&verifyFull){
      const reference=fullConeStep(this.readHead(),this.width,this.height,event);
      this.#statistics.oracle_cells+=this.cells;
      if(!reference.equals(this.#materialize(this.#candidates.get(key(chosen.branch,next)))))
        throw Error('independent full transition disagrees; candidate not authorized');
    }
    if(chosen){frame=this.#candidates.get(key(chosen.branch,next));wasReused=true;
      this.#statistics.commits_reused++;}
    else{const prev=this.#read(this.#head),flips=eventSet(event),out=Buffer.alloc(this.cells);
      for(let i=0;i<this.cells;i++)out[i]=afterEvent(lifeCell(prev,this.width,this.height,i),event,i,flips);
      frame=this.#dense(out,next,'committed-fallback');
      const baseline=this.#region.view(this.#baseline[next].region.handle);
      for(let i=0;i<this.cells;i++)if(out[i]!==baseline[i])frame.actual_diff.push(i);
      this.#statistics.commits_fallback++;
    }
    this.#head=frame;this.#history.push({ordinal:next,event,frame});
    // Prune every candidate that does not have the exact committed prefix.
    const active=new Map();
    for(const [id,p] of this.#branches){
      let matchesPrefix=p.events.length>=next;
      for(let j=0;j<next&&matchesPrefix;j++)matchesPrefix=even(eventSignature(p.events[j]),eventSignature(this.#history[j+1].event));
      if(matchesPrefix)active.set(id,p);
    }
    this.#branches=active;
    for(const name of [...this.#candidates.keys()]){
      const [branch,ordinalText]=name.split('@'),ordinal=Number(ordinalText);
      if(!active.has(branch)||ordinal<=next){this.#candidates.delete(name);this.#lineages.delete(name);}
    }
    this.#keepGC();
    return {ordinal:next,reused:wasReused,branch:chosen?.branch??'fallback',
      content_merkle_sha256:frame.digest,world_revision:this.#world,model_revision:this.#model,
      pending_frames:this.#candidates.size};
  }
  setWorldRevision(value){if(this.#busy)throw Error('field active');if(!ID.test(value))throw Error('invalid world revision');
    if(value===this.#world)return 0;this.#world=value;this.#blocked=true;const count=this.#candidates.size;
    this.#candidates.clear();this.#lineages.clear();this.#branches.clear();this.#keepGC();return count;
  }
  cancelBranch(branch){this.#guard();if(!this.#branches.has(branch))return false;
    const removed=new Set([branch]);let more=true;
    while(more){more=false;for(const p of this.#branches.values())
      if(!removed.has(p.branch)&&removed.has(p.parentBranch)){removed.add(p.branch);more=true;}}
    for(const id of removed)this.#branches.delete(id);
    for(const name of [...this.#candidates.keys()])if(removed.has(name.split('@')[0])){
      this.#candidates.delete(name);this.#lineages.delete(name);}
    this.#keepGC();return true;
  }
  verifyFull(branch,ordinal){const frame=this.#candidates.get(key(branch,ordinal));if(!frame)throw Error('candidate missing');
    const p=this.#branches.get(branch);if(!p||ordinal<1||ordinal>p.events.length)throw Error('invalid candidate proof');
    let reference=this.#materialize(this.#baseline[0]);
    for(let t=1;t<=ordinal;t++)reference=fullConeStep(reference,this.width,this.height,p.events[t-1]);
    return reference.equals(this.#materialize(frame))&&this.#root(this.#hashTiles(reference))===frame.digest;
  }
  close(){this.#blocked=true;this.#candidates.clear();this.#lineages.clear();this.#branches.clear();
    // Intentional explicit cleanup, does not revoke outside raw TypedArrays.
    for(const f of [...this.#frames])this.#releaseFrame(f);
    return this.#region.describe().mapped_bytes;
  }
}

// The existing R3 finite-volume model uses global dt/storage/flux audit; a
// local graph footprint is not complete. It must take the full fallback path.
export function fluidR3InfluencePolicy(){return Object.freeze({mode:'global-full',reason:'global timestep, junction storage and shared flux audit prevent local skip'});}
