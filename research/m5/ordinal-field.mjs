// M5 reference: ODTS-aligned bounded multi-ordinal field candidates.
// This file is independently authored for EveComputeField; it does not copy
// ODTS's pending-license implementation or change ODTS R0 commit authority.
import {createHash} from 'node:crypto';

const ID=/^[A-Za-z0-9_.:-]{1,96}$/;
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const hex=(...parts)=>{
  const h=createHash('sha256');
  for(const p of parts){const b=Buffer.isBuffer(p)?p:Buffer.from(String(p));
    const size=Buffer.alloc(8);size.writeBigUInt64BE(BigInt(b.length));h.update(size).update(b);}
  return h.digest('hex');
};
const asBytes=x=>{if(!Buffer.isBuffer(x))throw Error('transition must return Buffer');return Buffer.from(x);};
function safeJSON(x){
  if(x===null||typeof x==='string'||typeof x==='boolean')return x;
  if(typeof x==='number'&&Number.isFinite(x))return x;
  if(Array.isArray(x))return x.map(safeJSON);
  if(x&&typeof x==='object'&&(Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null)){
    const out=Object.create(null);
    for(const k of Object.keys(x).sort()){
      if(['__proto__','constructor','prototype'].includes(k))throw Error('unsafe event key');
      out[k]=safeJSON(x[k]);
    }
    return out;
  }
  throw Error('event must be a finite JSON value');
}
function encodeEvent(e){
  if(!e||typeof e!=='object'||Array.isArray(e)||!ID.test(e.kind??''))throw Error('invalid event');
  const copy=safeJSON(e);return {text:JSON.stringify(copy),event:JSON.parse(JSON.stringify(copy))};
}
const finiteInt=(v,min,max,name)=>{
  if(!Number.isSafeInteger(v)||v<min||v>max)throw Error(`invalid ${name}`);
  return v;
};
function frameDigest(parent,ordinal,worldRev,modelRev,eventText,payload){
  return hex('ECF-M5-ORDINAL-FRAME-V1',parent,ordinal,worldRev,modelRev,eventText,payload);
}
const k=(id,ordinal)=>`${id}|${ordinal}`;
const eventClone=(e)=>JSON.parse(JSON.stringify(e));

export class OrdinalDepthField {
  #head;#history;#plans=new Map();#candidates=new Map();#observers=new Map();
  #world;#model;#transition;#observe;#horizon;#limits;#pendingBytes=0;#busy=false;
  #count={prepared:0,observed:0,reused:0,fallback:0,discarded:0};
  constructor({fieldId='local-depth-field',initial,transition,observe=null,
    worldRevision='world-v0',modelRevision='model-v0',horizon=4,
    maxBranches=8,maxPendingBytes=16*1024*1024,maxFrameBytes=4*1024*1024,
    maxHistory=256}={}){
    if(!ID.test(fieldId)||typeof transition!=='function'||
       (observe!==null&&typeof observe!=='function')||!Buffer.isBuffer(initial)||
       !ID.test(worldRevision)||!ID.test(modelRevision))throw Error('invalid depth field identity/transition');
    finiteInt(horizon,0,64,'horizon');finiteInt(maxBranches,1,64,'maxBranches');
    finiteInt(maxPendingBytes,1,1024*1024*1024,'maxPendingBytes');
    finiteInt(maxFrameBytes,1,maxPendingBytes,'maxFrameBytes');
    finiteInt(maxHistory,1,1000000,'maxHistory');
    if(initial.byteLength>maxFrameBytes)throw Error('initial frame exceeds budget');
    this.fieldId=fieldId;this.#world=worldRevision;this.#model=modelRevision;
    this.#transition=transition;this.#observe=observe;this.#horizon=horizon;
    this.#limits={maxBranches,maxPendingBytes,maxFrameBytes,maxHistory};
    const initialBytes=Buffer.from(initial);
    this.#head={ordinal:0,world_revision:worldRevision,model_revision:modelRevision,
      event:null,event_text:'__genesis__',parent_digest:'0'.repeat(64),payload:initialBytes,
      digest:frameDigest('0'.repeat(64),0,worldRevision,modelRevision,'__genesis__',initialBytes)};
    this.#history=[this.#head];
  }
  get worldRevision(){return this.#world;}
  get modelRevision(){return this.#model;}
  get horizon(){return this.#horizon;}
  get head(){return this.#copy(this.#head);}
  get stats(){return {...this.#count,branches:this.#plans.size,candidates:this.#candidates.size,
    observers:this.#observers.size,pending_bytes:this.#pendingBytes,ordinal:this.#head.ordinal};}
  #guard(){if(this.#busy)throw Error('depth-field operation already active');}
  #copy(f){return {...f,payload:Buffer.from(f.payload),event:f.event===null?null:eventClone(f.event)};}
  #drop(key){const c=this.#candidates.get(key),o=this.#observers.get(key);
    if(c){this.#pendingBytes-=c.payload.byteLength;this.#candidates.delete(key);this.#count.discarded++;}
    if(o){this.#pendingBytes-=o.byteLength;this.#observers.delete(key);}
  }
  #dropBranch(id){for(const key of this.#candidates.keys())if(key.startsWith(`${id}|`))this.#drop(key);
    this.#plans.delete(id);
  }
  predict(branchId,events,{priority=0,parentBranch=null,forkDepth=1}={}){
    this.#guard();if(!ID.test(branchId)||this.#plans.has(branchId)||this.#plans.size>=this.#limits.maxBranches||
      !Array.isArray(events)||!events.length||events.length>this.#horizon||
      !Number.isSafeInteger(priority)||priority<-100000||priority>100000)
      throw Error('invalid branch or depth budget');
    finiteInt(forkDepth,1,events.length,'forkDepth');
    const canonical=events.map(encodeEvent);
    if(parentBranch!==null){
      const parent=this.#plans.get(parentBranch);if(!parent)throw Error('parent branch absent');
      if(parent.events.length<forkDepth-1||parent.startOrdinal!==this.#head.ordinal+1)
        throw Error('parent branch has incompatible ordinal prefix');
      for(let i=0;i<forkDepth-1;i++)if(parent.events[i].text!==canonical[i].text)
        throw Error('branch inheritance changes pre-fork event');
    } else if(forkDepth!==1)throw Error('orphan branch fork must begin at depth one');
    this.#plans.set(branchId,{id:branchId,parentBranch,forkDepth,priority,
      startOrdinal:this.#head.ordinal+1,events:canonical});
    return {id:branchId,start_ordinal:this.#head.ordinal+1,depth:canonical.length,
      parent_branch:parentBranch,fork_depth:forkDepth};
  }
  replaceBranchTail(branchId,fromOrdinal,events){
    this.#guard();const p=this.#plans.get(branchId);if(!p)throw Error('unknown branch');
    finiteInt(fromOrdinal,p.startOrdinal,p.startOrdinal+p.events.length-1,'replacement ordinal');
    const keep=fromOrdinal-p.startOrdinal,updated=[...p.events.slice(0,keep),...events.map(encodeEvent)];
    if(!updated.length||updated.length>this.#horizon)throw Error('replacement exceeds depth');
    if(p.parentBranch&&keep<p.forkDepth-1)throw Error('cannot alter inherited prefix');
    for(const key of [...this.#candidates.keys()]){
      const prefix=`${branchId}|`;if(key.startsWith(prefix)&&Number(key.slice(prefix.length))>=fromOrdinal)this.#drop(key);
    }
    p.events=updated;return {id:branchId,invalidated_from:fromOrdinal};
  }
  ready(){const tasks=[];for(const p of this.#plans.values()){
    for(let i=0;i<p.events.length;i++){
      const ordinal=p.startOrdinal+i,key=k(p.id,ordinal),physics=this.#candidates.get(key);
      if(!physics){
        const parent=i===0?this.#head:this.#candidates.get(k(p.id,ordinal-1));
        if(parent)tasks.push({branch:p.id,ordinal,depth:ordinal-this.#head.ordinal,role:'physics',priority:p.priority});
        // Later physics requires this ordinal, even if an observer is still waiting.
        break;
      }
      if(this.#observe&&!this.#observers.has(key))
        tasks.push({branch:p.id,ordinal,depth:ordinal-this.#head.ordinal,role:'observer',priority:p.priority});
    }
  }
  tasks.sort?.(()=>0);
  return tasks.sort((a,b)=>b.ordinal-a.ordinal||b.priority-a.priority||
    (a.role==='physics'?-1:1)-(b.role==='physics'?-1:1)||cmp(a.branch,b.branch));
  }
  async computeBudget(limit){this.#guard();finiteInt(limit,0,1000000,'compute budget');
    this.#busy=true;const outputs=[];
    try{
      for(let i=0;i<limit;i++){
        const task=this.ready()[0];if(!task)break;
        const plan=this.#plans.get(task.branch),index=task.ordinal-plan.startOrdinal,
          key=k(task.branch,task.ordinal),parent=index===0?this.#head:this.#candidates.get(k(task.branch,task.ordinal-1));
        const context={field_id:this.fieldId,branch_id:task.branch,parent_branch:plan.parentBranch,
          fork_depth:plan.forkDepth,absolute_ordinal:task.ordinal,relative_depth:task.depth,
          parent_digest:parent?.digest??null,world_revision:this.#world,model_revision:this.#model,
          authority:'speculative-only'};
        if(task.role==='physics'){
          if(!parent)throw Error('causal parent unavailable');
          const ev=plan.events[index],out=asBytes(await this.#transition(Buffer.from(parent.payload),eventClone(ev.event),context));
          if(out.byteLength>this.#limits.maxFrameBytes||this.#pendingBytes+out.byteLength>this.#limits.maxPendingBytes)
            throw Error('candidate exceeds materialization budget');
          const digest=frameDigest(parent.digest,task.ordinal,this.#world,this.#model,ev.text,out);
          const lineage=hex('ECF-M5-BRANCH-LINEAGE',task.branch,plan.parentBranch??'',plan.forkDepth,
            task.ordinal,parent.digest,digest);
          this.#candidates.set(key,{ordinal:task.ordinal,event:ev.event,event_text:ev.text,
            parent_digest:parent.digest,payload:out,digest,lineage,world_revision:this.#world,
            model_revision:this.#model});
          this.#pendingBytes+=out.byteLength;this.#count.prepared++;
          outputs.push({...task,digest,branch_lineage:lineage});
        } else {
          const physics=this.#candidates.get(key);if(!physics)throw Error('observer has no physics state');
          const out=asBytes(await this.#observe(Buffer.from(physics.payload),context));
          if(this.#pendingBytes+out.byteLength>this.#limits.maxPendingBytes)
            throw Error('observer exceeds materialization budget');
          this.#observers.set(key,out);this.#pendingBytes+=out.byteLength;this.#count.observed++;
          outputs.push({...task,digest:hex('ECF-M5-OBSERVER',physics.digest,out)});
        }
      }
      return outputs;
    }finally{this.#busy=false;}
  }
  candidate(branch,ordinal){const v=this.#candidates.get(k(branch,ordinal));return v?this.#copy(v):null;}
  observer(branch,ordinal){const b=this.#observers.get(k(branch,ordinal));return b?Buffer.from(b):null;}
  #verifiedCandidate(v,eventText){return v&&v.ordinal===this.#head.ordinal+1&&
    v.parent_digest===this.#head.digest&&v.event_text===eventText&&
    v.world_revision===this.#world&&v.model_revision===this.#model&&
    v.digest===frameDigest(v.parent_digest,v.ordinal,this.#world,this.#model,eventText,v.payload);}
  async commit(actualEvent,{verifyCandidate=null}={}){
    this.#guard();if(verifyCandidate!==null&&typeof verifyCandidate!=='function')throw Error('invalid commit verifier');
    const event=encodeEvent(actualEvent),next=this.#head.ordinal+1;
    this.#busy=true;
    try{
      const matching=[...this.#plans.values()].filter(p=>p.startOrdinal===next&&p.events[0]?.text===event.text)
        .sort((a,b)=>b.priority-a.priority||cmp(a.id,b.id));
      let selected=null,sourceBranch='fallback';
      for(const p of matching){const v=this.#candidates.get(k(p.id,next));if(!this.#verifiedCandidate(v,event.text))continue;
        if(verifyCandidate){const verified=await verifyCandidate(Buffer.from(this.#head.payload),eventClone(event.event),
          Buffer.from(v.payload),{world_revision:this.#world,model_revision:this.#model,ordinal:next});
          if(verified!==true)continue;
        }
        selected=v;sourceBranch=p.id;break;
      }
      const out=selected?Buffer.from(selected.payload):
        asBytes(await this.#transition(Buffer.from(this.#head.payload),eventClone(event.event),
          {field_id:this.fieldId,absolute_ordinal:next,world_revision:this.#world,
           model_revision:this.#model,authority:'reactive-fallback'}));
      if(out.byteLength>this.#limits.maxFrameBytes)throw Error('committed frame exceeds budget');
      const digest=frameDigest(this.#head.digest,next,this.#world,this.#model,event.text,out);
      if(selected&&digest!==selected.digest)throw Error('candidate differs from committed frame digest');
      const prior=this.#head;
      this.#head={ordinal:next,event:event.event,event_text:event.text,parent_digest:prior.digest,
        world_revision:this.#world,model_revision:this.#model,payload:out,digest};
      this.#history.push(this.#head);if(this.#history.length>this.#limits.maxHistory)this.#history.shift();
      this.#count[selected?'reused':'fallback']++;
      for(const p of [...this.#plans.values()]){
        if(p.startOrdinal!==next||p.events[0]?.text!==event.text){this.#dropBranch(p.id);continue;}
        this.#drop(k(p.id,next));p.events.shift();p.startOrdinal=next+1;
        if(!p.events.length){this.#dropBranch(p.id);continue;}
        // Preserve only candidates descending from the actual committed frame.
        const child=this.#candidates.get(k(p.id,next+1));
        if(child&&child.parent_digest!==digest){
          for(const key of [...this.#candidates.keys()])if(key.startsWith(`${p.id}|`))this.#drop(key);
        }
      }
      return {ordinal:next,digest,reused:!!selected,source_branch:sourceBranch,
        world_revision:this.#world,model_revision:this.#model,pending_candidates:this.#candidates.size};
    }finally{this.#busy=false;}
  }
  setWorldRevision(revision){this.#guard();if(!ID.test(revision))throw Error('invalid world revision');
    if(revision===this.#world)return 0;this.#world=revision;return this.#clearPlans();}
  setModelRevision(revision){this.#guard();if(!ID.test(revision))throw Error('invalid model revision');
    if(revision===this.#model)return 0;this.#model=revision;return this.#clearPlans();}
  #clearPlans(){const old=this.#candidates.size;for(const id of [...this.#plans.keys()])this.#dropBranch(id);return old;}
  setHorizon(value){this.#guard();finiteInt(value,0,64,'horizon');this.#horizon=value;
    for(const p of [...this.#plans.values()]){
      for(const key of [...this.#candidates.keys()])if(key.startsWith(`${p.id}|`)&&
        Number(key.slice(p.id.length+1))>this.#head.ordinal+value)this.#drop(key);
      p.events=p.events.slice(0,value);
      if(!p.events.length)this.#dropBranch(p.id);
    }
  }
  trace(){return this.#history.map(f=>({ordinal:f.ordinal,parent_digest:f.parent_digest,
    digest:f.digest,event:f.event===null?null:eventClone(f.event),
    world_revision:f.world_revision,model_revision:f.model_revision,
    payload_sha256:createHash('sha256').update(f.payload).digest('hex')}));}
}
