// Verify current source manifest against byte-exact Git blobs, not a text rendering.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const MANIFEST='MANIFEST_SHA256.txt';
const excluded=name=>/^MANIFEST_SHA256(?:_M\d+)?\.txt$/.test(name);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(repo,...args)=>execFileSync('git',['-C',repo,...args],{windowsHide:true,maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']});
function source(repo,ref){
  if(!ref||ref[0]==='-'||/[\r\n\0]/.test(ref))throw Error('invalid Git ref');
  const index=ref==='INDEX',records=index?git(repo,'ls-files','--stage','-z'):
    git(repo,'ls-tree','-r','-z',git(repo,'rev-parse','--verify',ref+'^{tree}').toString('utf8').trim());
  const objects=new Map();
  for(const line of records.toString('utf8').split('\0').filter(Boolean)){
    const tab=line.indexOf('\t');if(tab<0)throw Error('invalid Git listing');
    const name=line.slice(tab+1),[mode,a,b]=line.slice(0,tab).split(' ');
    if(!['100644','100755'].includes(mode)||(!index&&a!=='blob')||(index&&b!=='0'))throw Error(`non-regular or unmerged Git path: ${name}`);
    if(objects.has(name))throw Error('duplicate Git path');
    objects.set(name,index?a:b);
  }
  return {objects,read:name=>{
    const id=objects.get(name);if(!id)throw Error('unknown Git path: '+name);
    return git(repo,'cat-file','blob',id);
  }};
}
function listed(raw){
  const lines=raw.toString('utf8').split(/\n/).map(x=>x.trimEnd()).filter(Boolean),entries=new Map();
  if(lines[0]!=='# Current published source/evidence tree; excludes SHA256 manifest files.')throw Error('invalid manifest header');
  for(const s of lines.slice(1)){
    const m=/^([0-9a-f]{64})  (.+)$/.exec(s);
    if(!m||excluded(m[2])||m[2].startsWith('/')||m[2].split('/').includes('..')||entries.has(m[2]))throw Error('invalid/duplicate manifest path');
    entries.set(m[2],m[1]);
  }
  return entries;
}
export function verify({repo=root,ref='HEAD',checkWorktree=false}={}){
  const src=source(repo,ref),hashes=listed(src.read(MANIFEST)),errors=[];
  const expected=[...src.objects.keys()].filter(x=>!excluded(x));
  for(const name of expected){
    if(!hashes.has(name))errors.push(`unlisted source file: ${name}`);
    else if(sha(src.read(name))!==hashes.get(name))errors.push(`SHA mismatch: ${name}`);
  }
  for(const name of hashes.keys())if(!src.objects.has(name))errors.push(`missing source file: ${name}`);
  if(checkWorktree)for(const name of [...expected,MANIFEST]){
    try{const f=path.join(repo,...name.split('/')),stat=lstatSync(f);
      if(!stat.isFile()||stat.isSymbolicLink()||!readFileSync(f).equals(src.read(name)))
        errors.push(`checkout bytes mismatch: ${name}`);
    }catch{errors.push(`missing/non-regular checkout: ${name}`);}
  }
  return {ok:errors.length===0,ref,tracked_files:expected.length,errors};
}
export function refreshIndex({repo=root}={}){
  const src=source(repo,'INDEX'),paths=[...src.objects.keys()].filter(x=>!excluded(x)).sort();
  if(!src.objects.has(MANIFEST))throw Error('stage a manifest before refreshing');
  const output='# Current published source/evidence tree; excludes SHA256 manifest files.\n'+
    paths.map(name=>`${sha(src.read(name))}  ${name}\n`).join('');
  writeFileSync(path.join(repo,MANIFEST),output,'utf8');
  return {ok:true,from:'INDEX',tracked_files:paths.length};
}
function main(args){
  let repo=root,ref='HEAD',checkWorktree=false,write=false;
  for(let i=0;i<args.length;i++){
    if(args[i]==='--repo')repo=path.resolve(args[++i]??'');
    else if(args[i]==='--ref')ref=args[++i];
    else if(args[i]==='--check-worktree')checkWorktree=true;
    else if(args[i]==='--write-from-index')write=true;
    else throw Error('usage: check-source-manifest.mjs [--repo DIR] [--ref HEAD|INDEX|COMMIT] [--check-worktree] [--write-from-index]');
  }
  if(write&&(checkWorktree||ref!=='HEAD'))throw Error('--write-from-index must run separately');
  const result=write?refreshIndex({repo}):verify({repo,ref,checkWorktree});
  console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main(process.argv.slice(2));}catch(e){console.error(e.message);process.exitCode=1;}
}
