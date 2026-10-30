import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';import path from 'node:path';
import { originFor } from '../runtime-config.mjs';export { originFor };
export const here=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(here,'../..');
// Credential stays in memory; never returned by API, placed in URLs, or written to evidence.
const token=(await readFile(path.join(repo,'.evefield-local/control.token'),'utf8')).trim();
export async function api(port,method,route,body,allowFailure=false,extraHeaders={}){
  const r=await fetch(originFor(port)+route,{method,redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...extraHeaders},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await r.text();let value;try{value=text?JSON.parse(text):null;}catch{value={message:text};}
  if(!r.ok&&!allowFailure)throw Error(`local API ${port} HTTP ${r.status}: ${value.error??value.message??'request refused'}`);return {status:r.status,value};
}
