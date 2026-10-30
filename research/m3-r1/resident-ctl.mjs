import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { originFor } from '../runtime-config.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(here,'../..'),action=process.argv[2]??'status';
const current=JSON.parse(await readFile(path.join(here,'.runtime/current-resident.json'),'utf8'));
const token=(await readFile(path.join(repo,'.evefield-local/control.token'),'utf8')).trim();
let method='GET',route=`/v1/resident/${current.id}`,body;
if(action==='advance'){method='POST';route+='/advance';body={steps:Number(process.argv[3]??80)};}
else if(action==='checkpoint'){method='POST';route+='/checkpoint';body={};}
else if(action==='reorganize'){method='POST';route+='/reorganize';const n=Number(process.argv[3]??4);body={partitions:n,organization:process.argv[4]??(n===1?'monolithic':'partitioned-workers')};}
else if(action!=='status')throw Error('usage: resident-ctl.mjs status | advance [steps] | checkpoint | reorganize [partitions] [organization]');
const response=await fetch(originFor(8766)+route,{method,redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
const text=await response.text();if(!response.ok){console.error(text);process.exitCode=1;}else console.log(JSON.stringify(JSON.parse(text),null,2));
