import { readFile } from 'node:fs/promises';import path from 'node:path';import { api,here } from './client.mjs';
const current=JSON.parse(await readFile(path.join(here,'.runtime/current.json'),'utf8')),action=process.argv[2]??'status',id=current.field_id;
let r;if(action==='status')r=await api(8767,'GET',`/v2/resident/${id}`);
else if(action==='advance')r=await api(8767,'POST',`/v2/resident/${id}/advance`,{steps:Number(process.argv[3]??80)});
else if(action==='checkpoint')r=await api(8767,'POST',`/v2/resident/${id}/checkpoint`,{});
else if(action==='reorganize')r=await api(8767,'POST',`/v2/resident/${id}/reorganize`,{partitions:Number(process.argv[3]??2),organization:process.argv[4]??'partitioned-workers',exchange:process.argv[5]??'direct'});
else throw Error('actions: status | advance [80] | checkpoint | reorganize [2] [partitioned-workers] [direct]');console.log(JSON.stringify(r.value,null,2));
