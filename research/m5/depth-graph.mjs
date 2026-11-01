// M5 reference: declared causal depth/ordinal DAG excitation, not an OS scheduler.
// The graph is correct only when the caller's declared dependencies are complete.
import {createHash} from 'node:crypto';

const ID=/^[A-Za-z0-9_.:-]{1,96}$/;
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const hash = (...parts) => {
  const h=createHash('sha256');
  for(const p of parts){const b=Buffer.isBuffer(p)?p:Buffer.from(String(p));
    const length=Buffer.alloc(8);length.writeBigUInt64BE(BigInt(b.byteLength));h.update(length).update(b);}
  return h.digest('hex');
};
const bounded=(x,lo,hi,name)=>{
  if(!Number.isSafeInteger(x)||x<lo||x>hi)throw Error(`invalid ${name}`);
  return x;
};
const bytes=x=>{if(!Buffer.isBuffer(x))throw Error('payload must be Buffer');return Buffer.from(x);};

export class DepthExcitationGraph {
  #nodes=new Map();#successors=new Map();#values=new Map();#compute;#revision;#budget;#total=0;
  #operations={computed:0,invalidated:0,source_changes:0};#busy=false;
  constructor({nodes,compute,worldRevision='world-v0',maxBytes=64*1024*1024}={}){
    if(!Array.isArray(nodes)||nodes.length<1||nodes.length>100000||typeof compute!=='function'||
       typeof worldRevision!=='string'||!worldRevision||!Number.isSafeInteger(maxBytes)||maxBytes<1)
      throw Error('invalid excitation graph configuration');
    this.#compute=compute;this.#revision=worldRevision;this.#budget=maxBytes;
    for(const n of nodes){
      if(!ID.test(n?.id??'')||this.#nodes.has(n.id)||!['source','compute','observer'].includes(n.role)||
         !Number.isSafeInteger(n.ordinal)||n.ordinal<0||n.ordinal>1000000||
         !Number.isSafeInteger(n.priority??0)||!Array.isArray(n.depends_on)||
         new Set(n.depends_on).size!==n.depends_on.length||
         n.depends_on.some(d=>!ID.test(d)))throw Error('invalid or duplicate depth graph node');
      if(n.role==='source'&&(n.ordinal!==0||n.depends_on.length))throw Error('source must be ordinal-0 root');
      if(n.role!=='source'&&(!n.depends_on.length||n.ordinal<1))throw Error('computed node requires causal parents and ordinal');
      this.#nodes.set(n.id,Object.freeze({id:n.id,role:n.role,ordinal:n.ordinal,
        priority:n.priority??0,depends_on:Object.freeze([...n.depends_on])}));
      this.#successors.set(n.id,new Set());
    }
    for(const n of this.#nodes.values())for(const d of n.depends_on){
      const parent=this.#nodes.get(d);
      if(!parent||parent.ordinal>n.ordinal)throw Error('missing or future-ordinal dependency');
      this.#successors.get(d).add(n.id);
    }
    const marks=new Map();
    const dfs=id=>{const m=marks.get(id);if(m===1)throw Error('cyclic causal graph');if(m===2)return;
      marks.set(id,1);for(const d of this.#nodes.get(id).depends_on)dfs(d);marks.set(id,2);};
    for(const id of this.#nodes.keys())dfs(id);
  }
  get worldRevision(){return this.#revision;}
  get bytesUsed(){return this.#total;}
  get stats(){return {...this.#operations,materialized:this.#values.size,bytes:this.#total};}
  #drop(id){const prior=this.#values.get(id);if(prior){this.#total-=prior.payload.byteLength;
      this.#values.delete(id);this.#operations.invalidated++;}}
  #cone(ids){const seen=new Set(ids),queue=[...seen];
    while(queue.length)for(const downstream of this.#successors.get(queue.shift())||[]){
      if(!seen.has(downstream)){seen.add(downstream);queue.push(downstream);}}
    return seen;
  }
  setSource(id,raw,{influence='global'}={}){
    if(this.#busy)throw Error('compute in progress; cannot mutate graph sources');
    const n=this.#nodes.get(id);if(n?.role!=='source'||!['declared','global'].includes(influence))
      throw Error('unknown source or incomplete influence policy');
    const value=bytes(raw),prior=this.#values.get(id);
    if(prior?.payload.equals(value))return {changed:false,invalidated:0};
    if(value.byteLength>this.#budget||this.#total-(prior?.payload.byteLength??0)+value.byteLength>this.#budget)
      throw Error('materialization budget exceeded');
    const affected=influence==='global'
      ?new Set([...this.#nodes.keys()].filter(k=>this.#nodes.get(k).role!=='source'))
      :this.#cone([id]);
    let removed=0;for(const k of affected){if(k===id)continue;if(this.#values.has(k)){this.#drop(k);removed++;}}
    if(prior)this.#drop(id);
    const record={payload:value,digest:hash('ECF-M5-SOURCE',id,value),parents:[]};
    this.#values.set(id,record);this.#total+=value.byteLength;this.#operations.source_changes++;
    return {changed:true,invalidated:removed,policy:influence};
  }
  invalidate(ids,{influence='global'}={}){
    if(this.#busy)throw Error('compute in progress; cannot invalidate graph');
    if(!Array.isArray(ids)||!ids.length||ids.some(id=>!this.#nodes.has(id))||
       !['declared','global'].includes(influence))throw Error('invalid influence invalidation');
    const affected=influence==='global'
      ?new Set([...this.#nodes.keys()].filter(id=>this.#nodes.get(id).role!=='source'))
      :this.#cone(ids);
    let count=0;for(const id of affected)if(this.#nodes.get(id).role!=='source'&&this.#values.has(id)){
      this.#drop(id);count++;}
    return {invalidated:count,affected:[...affected].sort()};
  }
  setWorldRevision(revision){if(this.#busy)throw Error('compute in progress; cannot change world revision');
    if(typeof revision!=='string'||!revision)throw Error('invalid world revision');
    if(revision===this.#revision)return 0;this.#revision=revision;
    return this.invalidate([...this.#nodes.keys()],{influence:'global'}).invalidated;
  }
  ready(){return [...this.#nodes.values()]
    .filter(n=>n.role!=='source'&&!this.#values.has(n.id)&&n.depends_on.every(id=>this.#values.has(id)))
    .sort((a,b)=>b.ordinal-a.ordinal||b.priority-a.priority||cmp(a.id,b.id))
    .map(n=>({id:n.id,ordinal:n.ordinal,role:n.role,priority:n.priority}));}
  async computeBudget(limit){bounded(limit,0,1000000,'compute budget');
    if(this.#busy)throw Error('compute already in progress');this.#busy=true;const completed=[];
    try{for(let i=0;i<limit;i++){
      const next=this.ready()[0];if(!next)break;const n=this.#nodes.get(next.id);
      const parents=n.depends_on.map(id=>this.#values.get(id));
      const out=bytes(await this.#compute({...n,depends_on:[...n.depends_on]},parents.map(p=>bytes(p.payload))));
      if(this.#total+out.byteLength>this.#budget)throw Error('materialization budget exceeded');
      const digest=hash('ECF-M5-TASK',this.#revision,n.id,n.ordinal,
        ...parents.map(p=>p.digest),out);
      this.#values.set(n.id,{payload:out,digest,parents:parents.map(p=>p.digest)});
      this.#total+=out.byteLength;this.#operations.computed++;completed.push({...next,digest});
    }
    return completed;}finally{this.#busy=false;}
  }
  get(id){const v=this.#values.get(id);if(!v)return null;
    return {id,payload:bytes(v.payload),digest:v.digest,parents:[...v.parents],world_revision:this.#revision};}
  auditReady(id){const n=this.#nodes.get(id),v=this.#values.get(id);if(!n||!v)return false;
    if(n.role==='source')return v.digest===hash('ECF-M5-SOURCE',id,v.payload);
    const parents=n.depends_on.map(k=>this.#values.get(k));if(parents.some(x=>!x))return false;
    const hashes=parents.map(p=>p.digest);
    return hashes.every((x,i)=>x===v.parents[i])&&
      v.digest===hash('ECF-M5-TASK',this.#revision,n.id,n.ordinal,...hashes,v.payload);
  }
}
