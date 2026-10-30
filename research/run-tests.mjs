import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),files=['examples/fluid/fluid.test.js','research/runtime-config.test.mjs'];
for(const round of ['m3-r1','m3-r2','m3-r3','m4'])
  for(const f of await readdir(path.join(repo,'research',round)))
    if(f.endsWith('.test.mjs'))files.push(`research/${round}/${f}`);
const r=spawnSync(process.execPath,['--test',...files],{cwd:repo,stdio:'inherit',windowsHide:true});
if(r.error)throw r.error;
process.exitCode=r.status??1;
