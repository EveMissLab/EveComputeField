import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ResidentManager, validateReceipt } from './resident-manager.mjs';
import { KERNEL_SHA, digest } from './solver.mjs';
import { originFor,portFor } from '../runtime-config.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../..');
const token = (await readFile(path.join(repo,'.evefield-local/control.token'),'utf8')).trim();
const logRoot = path.join(here,'.runtime/resident-events'); await mkdir(logRoot,{recursive:true});
const manager = new ResidentManager((id, event) => appendFile(path.join(logRoot,`${id}.jsonl`),JSON.stringify(event)+'\n'));
async function field(method, route, body) {
  const response = await fetch(originFor(8765)+route,{method,redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await response.text();if(!response.ok)throw Error(`field persistence HTTP ${response.status}: ${text}`);return text?JSON.parse(text):null;
}
async function persistedHead(id) {
  let last=null;
  try { const data=await readFile(path.join(logRoot,`${id}.jsonl`),'utf8');for(const line of data.split('\n').filter(Boolean)){const r=JSON.parse(line);validateReceipt(r);if(r.previous_sha256!==(last?.receipt_sha256??null))throw Error('resident audit chain invalid');last=r;} }
  catch(error){if(error.code!=='ENOENT')throw error;}
  return last;
}
function send(res, status, value) { res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value)); }
const server=http.createServer(async(req,res)=>{
  try {
    if(req.headers.origin){send(res,403,{error:'browser Origin requests denied'});return;}
    const actual=Buffer.from(req.headers.authorization??''),expected=Buffer.from(`Bearer ${token}`);
    if(actual.length!==expected.length||!timingSafeEqual(actual,expected)){send(res,401,{error:'authorization required'});return;}
    const parts=new URL(req.url,'http://127.0.0.1').pathname.split('/').filter(Boolean);
    if(parts[0]!=='v1'||parts[1]!=='resident'){send(res,404,{error:'not found'});return;}
    let text='',bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>131072)throw Error('request too large');text+=chunk;}
    const input=text?JSON.parse(text):{};
    if(parts.length===2&&req.method==='GET'){send(res,200,{active:[...manager.entries.values()].filter(e=>!e.blocked&&!e.pendingAssociation).map(e=>e.id),pending_or_blocked:[...manager.entries.values()].filter(e=>e.blocked||e.pendingAssociation).map(e=>e.id),mode:'resident-RAM-no-idle-eviction',rss_bytes:process.memoryUsage().rss});return;}
    if(parts.length===2&&req.method==='POST'){
      const id=input.id;if(!/^[A-Za-z0-9_-]{1,96}$/.test(id??''))throw Error('invalid field id');
      await field('GET',`/v1/fields/${id}`);
      let checkpoint=null,options=input.options??{},receipt=null;
      if(input.restore){const saved=await field('GET',`/v1/fields/${id}/memory/continuity/resident_latest`),p=JSON.parse(saved.value);checkpoint=p.checkpoint;options=p.options;receipt=p.receipt;const last=await persistedHead(id);if(last?.receipt_sha256!==receipt?.receipt_sha256)throw Error('audit tail differs from saved checkpoint; explicit recovery required');}
      else if(await persistedHead(id))throw Error('resident audit already exists; restore or choose a new field id');
      const created=await manager.createAndBind(id,input.config??{},options,checkpoint,receipt,async entry=>{
        await field('PUT',`/v1/fields/${id}/memory/continuity/resident_binding`,{value:JSON.stringify({schema:'ecf-resident-sidecar-binding/v1',field_id:id,kernel_sha256:KERNEL_SHA,config_sha256:digest(entry.solver.config),scope:'ID-associated research sidecar; not a core FieldSpec solver declaration'})});
      });
      send(res,200,created);return;
    }
    const id=parts[2];if(!/^[A-Za-z0-9_-]{1,96}$/.test(id??''))throw Error('invalid field id');
    if(parts.length===3&&req.method==='GET'){send(res,200,manager.view(id));return;}
    if(parts[3]==='advance'&&req.method==='POST'){send(res,200,await manager.advance(id,input.steps));return;}
    if(parts[3]==='reorganize'&&req.method==='POST'){send(res,200,await manager.reorganize(id,input.partitions,input.organization));return;}
    if(parts[3]==='checkpoint'&&req.method==='POST'){
      const saved=await manager.persist(id,async snapshot=>{const start=performance.now(),value=JSON.stringify(snapshot);
        await field('PUT',`/v1/fields/${id}/memory/continuity/resident_latest`,{value});
        return{saved:true,state_sha256:snapshot.checkpoint.integrity_sha256,receipt_head:snapshot.receipt?.receipt_sha256??null,bytes:Buffer.byteLength(value),elapsed_ms:performance.now()-start};});
      send(res,200,saved);return;
    }
    send(res,404,{error:'not found'});
  } catch(error){send(res,400,{error:error.message});}
});
server.listen(portFor(8766),'127.0.0.1',()=>console.log(`M3_RESIDENT_READY ${originFor(8766)} (RAM and worker pools retained; explicit calls only)`));
let stopping=false;
async function stop(){if(stopping)return;stopping=true;await new Promise(resolve=>server.close(resolve));await manager.close();process.exitCode=0;}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
