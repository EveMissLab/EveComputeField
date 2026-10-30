import { finite } from '../m3-r2/util.mjs';import { sourceConfig } from '../m3-r2/components.mjs';
export const TILE=256;
export function makeNetwork({trunk=3,tributaries=3,cells=256,still=false,uniform=false,pulse=false,tide=0,area=40}={}){
  if(!Number.isInteger(trunk)||trunk<1||trunk>32||!Number.isInteger(tributaries)||tributaries<0||tributaries>96||trunk===1&&tributaries)throw Error('invalid network shape');
  const nodes=[],reaches=[],falls=[],source=1/(tributaries+1),eta=i=>2.15-.62*i/trunk,bed=i=>1.05-.72*i/trunk;
  for(let i=0;i<=trunk;i++)nodes.push({id:i===0?'deep-basin':i===trunk?'ocean':`junction-${i}`,area:i===trunk?600:i===0?30:area,bottom:bed(i),stage:eta(i),min_stage:bed(i)+.08,external:i===trunk?{stage:eta(i),base:1,rating:.5,amplitude:tide,period:6}:null});
  const added=new Array(trunk+1).fill(0);
  for(let b=0;b<tributaries;b++){
    const target=1+b%(trunk-1),from=nodes.length,z=bed(target)+.4;
    nodes.push({id:`tributary-basin-${b}`,area:30,bottom:z,stage:eta(target)+.5,min_stage:z+.08,external:null});
    reaches.push({id:`tributary-${b}`,from,to:target,cells,length:48,width:1,bed_up:z,bed_down:bed(target),roughness:.028,initial_q:source});
    falls.push({node:from,height:12+2*(b%3),source:{kind:pulse?'pulse':'constant',base:source,amplitude:pulse?.8*source:0,at:2,duration:2,period:6}});added[target]+=source;
  }
  let q=source;for(let i=0;i<trunk;i++){if(i)q+=added[i];reaches.push({id:`trunk-${i}`,from:i,to:i+1,cells,length:96/trunk,width:1,bed_up:bed(i),bed_down:bed(i+1),roughness:.028,initial_q:q});}
  falls.unshift({node:0,height:12,source:{kind:pulse?'pulse':'constant',base:source,amplitude:pulse?.8*source:0,at:2,duration:2,period:6}});
  if(still){for(const n of nodes){n.stage=2.2;if(n.external){n.external.stage=2.2;n.external.base=0;n.external.amplitude=0;}}for(const e of reaches)e.initial_q=0;for(const f of falls){f.source.base=0;f.source.amplitude=0;}}
  if(uniform){for(const n of nodes){n.bottom=0;n.stage=1.2;n.min_stage=.02;if(n.external){n.external.stage=1.2;n.external.amplitude=0;}}for(const e of reaches){e.bed_up=0;e.bed_down=0;e.roughness=0;}}
  return {schema:'ecf-water-network/v3',nodes,reaches,falls};
}
export function validateGraph(input){
  const g=structuredClone(input);if(g.schema!=='ecf-water-network/v3'||!Array.isArray(g.nodes)||g.nodes.length<2||g.nodes.length>256||!Array.isArray(g.reaches)||g.reaches.length<1||g.reaches.length>128||!Array.isArray(g.falls)||g.falls.length>128)throw Error('invalid graph');
  const ids=new Set();for(const n of g.nodes){if(!/^[A-Za-z0-9_-]{1,64}$/.test(n.id)||ids.has(n.id))throw Error('duplicate/invalid node');ids.add(n.id);finite(n.area,'area',.001,1e9);finite(n.bottom,'bottom',-1000,1000);finite(n.stage,'stage',n.bottom+.02,1000);finite(n.min_stage,'minimum wet stage',n.bottom+.02,n.stage);
    if(n.external){for(const k of['stage','base'])finite(n.external[k],k,-1000,1000);finite(n.external.rating,'rating',0,1000);finite(n.external.amplitude,'tide amplitude',0,100);finite(n.external.period,'tide period',.01,10000);}
  }
  const degree=new Array(g.nodes.length).fill(0),adj=g.nodes.map(()=>[]),indeg=degree.slice();let total=0;ids.clear();
  for(const r of g.reaches){if(!/^[A-Za-z0-9_-]{1,64}$/.test(r.id)||ids.has(r.id))throw Error('duplicate/invalid reach');ids.add(r.id);if(!Number.isInteger(r.from)||!Number.isInteger(r.to)||r.from===r.to||!g.nodes[r.from]||!g.nodes[r.to])throw Error('invalid reach endpoints');if(!Number.isInteger(r.cells)||r.cells<8||r.cells>1048576)throw Error('invalid cell count');total+=r.cells;finite(r.length,'length',.1,10000);finite(r.width,'width',.01,1000);finite(r.roughness,'roughness',0,.2);finite(r.initial_q,'initial q',-100,100);
    for(const k of['bed_up','bed_down'])finite(r[k],k,-1000,1000);
    for(const[k,z]of[[r.from,Math.max(r.bed_up,r.bed_up+(r.bed_down-r.bed_up)*.5/r.cells)],[r.to,Math.max(r.bed_down,r.bed_down+(r.bed_up-r.bed_down)*.5/r.cells)]])if(g.nodes[k].min_stage<z+.02-1e-12)throw Error('minimum node stage does not protect wet endpoint');
    degree[r.from]++;degree[r.to]++;adj[r.from].push(r.to);indeg[r.to]++;
  }
  if(total>1048576||degree.some(x=>x===0))throw Error('disconnected/oversize graph');const queue=indeg.map((x,i)=>x===0?i:-1).filter(x=>x>=0);let visited=0;while(queue.length){const n=queue.shift();visited++;for(const to of adj[n])if(--indeg[to]===0)queue.push(to);}if(visited!==g.nodes.length)throw Error('network must be a directed acyclic reach graph');
  for(const f of g.falls){if(!Number.isInteger(f.node)||!g.nodes[f.node])throw Error('invalid waterfall node');finite(f.height,'fall height',0,1000);f.source=sourceConfig(f.source);}
  return g;
}
export function layoutGraph(g){let offset=0,face=0;const tiles=[],reaches=g.reaches.map((e,index)=>{const r={...e,index,offset,face,dx:e.length/e.cells,tileStart:tiles.length};for(let start=0;start<e.cells;start+=TILE)tiles.push({edge:index,start,end:Math.min(start+TILE,e.cells)});r.tileEnd=tiles.length;offset+=e.cells;face+=e.cells+1;return r;});return {reaches,tiles,cells:offset,faces:face};}
