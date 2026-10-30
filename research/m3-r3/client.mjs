import { readFile } from 'node:fs/promises';import { fileURLToPath } from 'node:url';import path from 'node:path';
import { originFor } from '../runtime-config.mjs';export { originFor };
export const here=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(here,'../..');
const token=(await readFile(path.join(repo,'.evefield-local/control.token'),'utf8')).trim();
export async function api(port,method,route,body,allowFailure=false,extra={}){const response=await fetch(originFor(port)+route,{method,redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...extra},body:body===undefined?undefined:JSON.stringify(body)});const text=await response.text();let value;try{value=text?JSON.parse(text):null;}catch{value={message:text};}if(!response.ok&&!allowFailure)throw Error(`local HTTP ${port}/${response.status}: ${value.error??value.message??'refused'}`);return {status:response.status,value};}
