import http from 'node:http';import { timingSafeEqual } from 'node:crypto';
import { readFile,appendFile,mkdir } from 'node:fs/promises';import path from 'node:path';import { performance } from 'node:perf_hooks';
import { ResidentManager,validateReceipt } from './resident-manager.mjs';import { KERNEL_SHA,digest } from './solver.mjs';import { api,here,repo } from './client.mjs';
import { originFor,portFor } from '../runtime-config.mjs';const PORT=portFor(8767);
const token=(await readFile(path.join(repo,'.evefield-local/control.token'),'utf8')).trim(),logs=path.join(here,'.runtime/events');await mkdir(logs,{recursive:true});
const manager=new ResidentManager((id,r)=>appendFile(path.join(logs,`${id}.jsonl`),JSON.stringify(r)+'\n'));let demo=null;
const field=async(method,route,body)=>(await api(8765,method,route,body)).value;
async function logHead(id){let last=null;try{const text=await readFile(path.join(logs,`${id}.jsonl`),'utf8');for(const line of text.split('\n').filter(Boolean)){const r=JSON.parse(line);validateReceipt(r);if(r.field_id!==id||r.previous_sha256!==(last?.receipt_sha256??null))throw Error('invalid audit chain');last=r;}}catch(e){if(e.code!=='ENOENT')throw e;}return last;}
function send(res,status,value){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
const assets={'/':['viewer.html','text/html; charset=utf-8'],'/viewer.js':['viewer.js','text/javascript'],'/viewer.css':['viewer.css','text/css'],'/scene.svg':['../../examples/fluid/scene.svg','image/svg+xml']};
const server=http.createServer(async(req,res)=>{try{
  if(![`127.0.0.1:${PORT}`,`localhost:${PORT}`].includes(req.headers.host)){send(res,403,{error:'loopback host required'});return;}
  const pathname=new URL(req.url,'http://127.0.0.1:8767').pathname;
  if(req.method==='GET'&&Object.hasOwn(assets,pathname)){const [f,type]=assets[pathname];res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});res.end(await readFile(path.resolve(here,f)));return;}
  if(req.method==='GET'&&pathname==='/demo/state'){
    if(!demo){send(res,503,{error:'demo not associated yet'});return;}const e=manager.entry(demo);if(e.blocked){send(res,503,{error:'demo paused for audit recovery'});return;}
    send(res,200,{schema:'ecf-storage-demo-readonly/v2',id:demo,metrics:e.solver.measure(),organization:e.solver.organization(),river:{h:[...e.solver.h],q:[...e.solver.q],bed:[...e.solver.bed],length:e.solver.config.length,width:e.solver.config.width},kernel_sha256:KERNEL_SHA,state_sha256:e.solver.checkpoint().integrity_sha256});return;
  }
  if(req.headers.origin){send(res,403,{error:'browser Origin control requests denied'});return;}
  const a=Buffer.from(req.headers.authorization??''),b=Buffer.from(`Bearer ${token}`);if(a.length!==b.length||!timingSafeEqual(a,b)){send(res,401,{error:'authorization required'});return;}
  let text='',bytes=0;for await(const part of req){bytes+=part.length;if(bytes>131072)throw Error('request too large');text+=part;}const input=text?JSON.parse(text):{};
  const parts=pathname.split('/').filter(Boolean);if(parts[0]!=='v2'||parts[1]!=='resident'){send(res,404,{error:'not found'});return;}
  if(parts.length===2&&req.method==='GET'){send(res,200,{mode:'resident-RAM-no-idle-eviction',active:[...manager.entries.keys()],demo,rss_bytes:process.memoryUsage().rss});return;}
  if(parts.length===2&&req.method==='POST'){
    const id=input.id;if(!/^[A-Za-z0-9_-]{1,96}$/.test(id??''))throw Error('invalid id');await field('GET',`/v1/fields/${id}`);let checkpoint=null,options=input.options??{},receipt=null;
    if(input.restore){const saved=await field('GET',`/v1/fields/${id}/memory/continuity/r2_latest`),p=JSON.parse(saved.value);checkpoint=p.checkpoint;options=p.options;receipt=p.receipt;if((await logHead(id))?.receipt_sha256!==receipt?.receipt_sha256)throw Error('unsaved audit tail; explicit recovery required');}
    else if(await logHead(id))throw Error('audit already exists; restore or new field id required');
    const result=await manager.createAndBind(id,input.config??{},options,checkpoint,receipt,async e=>field('PUT',`/v1/fields/${id}/memory/continuity/r2_binding`,{value:JSON.stringify({schema:'ecf-storage-sidecar-binding/v2',field_id:id,kernel_sha256:KERNEL_SHA,config_sha256:digest(e.solver.config),scope:'ID-associated local research sidecar, not a core FieldSpec solver'})}));if(input.demo===true)demo=id;send(res,200,result);return;
  }
  const id=parts[2];if(!/^[A-Za-z0-9_-]{1,96}$/.test(id??''))throw Error('invalid id');
  if(parts.length===3&&req.method==='GET'){send(res,200,manager.view(id));return;}
  if(parts.length===4&&req.method==='POST'){
    if(parts[3]==='advance'){send(res,200,await manager.advance(id,input.steps));return;}
    if(parts[3]==='reorganize'){send(res,200,await manager.reorganize(id,input.partitions,input.organization,input.exchange));return;}
    if(parts[3]==='checkpoint'){const result=await manager.persist(id,async snapshot=>{const begin=performance.now(),value=JSON.stringify(snapshot);await field('PUT',`/v1/fields/${id}/memory/continuity/r2_latest`,{value});return {saved:true,state_sha256:snapshot.checkpoint.integrity_sha256,receipt_head:snapshot.receipt?.receipt_sha256??null,bytes:Buffer.byteLength(value),elapsed_ms:performance.now()-begin};});send(res,200,result);return;}
  }send(res,404,{error:'not found'});
}catch(error){send(res,400,{error:error.message});}});
server.listen(PORT,'127.0.0.1',()=>console.log(`M3_R2_READY ${originFor(8767)} | retained RAM | explicit calls only | read-only SVG viewer`));
let stopping=false;async function stop(){if(stopping)return;stopping=true;await new Promise(r=>server.close(r));await manager.close();process.exitCode=0;}process.on('SIGINT',stop);process.on('SIGTERM',stop);
