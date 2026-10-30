import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT='research/evidence/';
const MANIFEST=ROOT+'manifest.json';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const defaultRepo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

function entryPaths(manifest){
  if(manifest?.schema!=='ecf-public-research-evidence/v1'||!Array.isArray(manifest.entries)||!manifest.entries.length)throw Error('invalid evidence manifest schema/entries');
  const seen=new Set();
  return manifest.entries.map(entry=>{
    const name=entry.path;
    if(typeof name!=='string'||!name||/[\\:\0\r\n]/.test(name)||path.posix.isAbsolute(name)||name.split('/').some(p=>!p||p==='.'||p==='..')||['manifest.json','README.md'].includes(name))throw Error('invalid evidence entry path');
    if(seen.has(name))throw Error(`duplicate evidence entry: ${name}`);
    if(!/^[0-9a-f]{64}$/.test(entry.sha256)||!Number.isSafeInteger(entry.bytes)||entry.bytes<0)throw Error(`invalid hash/byte metadata: ${name}`);
    seen.add(name);return name;
  });
}

export function validateManifest(manifest,readBytes,assetPaths){
  const names=entryPaths(manifest),listed=new Set(names),available=new Set(assetPaths),errors=[];
  for(const name of available)if(!listed.has(name))errors.push(`unlisted evidence asset: ${name}`);
  for(const entry of manifest.entries){
    if(!available.has(entry.path)){errors.push(`missing evidence asset: ${entry.path}`);continue;}
    const bytes=readBytes(entry.path);
    if(bytes.length!==entry.bytes)errors.push(`byte length mismatch: ${entry.path} (listed ${entry.bytes}, actual ${bytes.length})`);
    if(sha256(bytes)!==entry.sha256)errors.push(`SHA-256 mismatch: ${entry.path}`);
  }
  return {ok:errors.length===0,entries:names.length,errors};
}

export function gitEvidence(repo,ref='HEAD'){
  const git=(...args)=>execFileSync('git',['-C',repo,...args],{maxBuffer:64*1024*1024,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const index=ref==='INDEX';
  if(!ref||ref.startsWith('-')||/[\0\r\n]/.test(ref))throw Error('invalid Git reference');
  const snapshot=index?'INDEX':git('rev-parse','--verify',ref+'^{tree}').toString('utf8').trim();
  const records=git(...(index?['ls-files','--stage','-z']:['ls-tree','-r','-z',snapshot,'--',ROOT])).toString('utf8').split('\0').filter(Boolean),objects=new Map();
  for(const record of records){
    const tab=record.indexOf('\t'),name=record.slice(tab+1);if(!name.startsWith(ROOT))continue;
    const [mode,second,third]=record.slice(0,tab).split(' '),oid=index?second:third;
    if(index&&third!=='0')throw Error(`unmerged evidence path: ${name}`);
    if(!['100644','100755'].includes(mode)||!index&&second!=='blob')throw Error(`non-regular evidence asset: ${name}`);
    if(objects.has(name))throw Error(`ambiguous evidence path: ${name}`);
    objects.set(name,oid);
  }
  const cache=new Map(),readGit=name=>{
    const oid=objects.get(name);if(!oid)throw Error(`asset not in Git snapshot: ${name}`);
    if(!cache.has(oid))cache.set(oid,git('cat-file','blob',oid));
    return cache.get(oid);
  };
  const manifestBytes=readGit(MANIFEST),manifest=JSON.parse(manifestBytes.toString('utf8'));
  const assetPaths=[...objects.keys()].filter(n=>n!==MANIFEST&&n!==ROOT+'README.md').map(n=>n.slice(ROOT.length));
  const boundSnapshot=index?'INDEX:'+sha256(Buffer.from(JSON.stringify([...objects]))):snapshot;
  return {snapshot:boundSnapshot,manifest,manifestBytes,assetPaths,readBytes:name=>readGit(ROOT+name)};
}

export function verifyEvidence({repo=defaultRepo,ref='HEAD',checkWorktree=false}={}){
  const source=gitEvidence(repo,ref),result=validateManifest(source.manifest,source.readBytes,source.assetPaths);
  if(checkWorktree){
    for(const name of ['manifest.json',...source.assetPaths]){
      const file=path.join(repo,ROOT,...name.split('/'));
      try{
        const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('not a regular file');
        const expected=name==='manifest.json'?source.manifestBytes:source.readBytes(name);
        if(!readFileSync(file).equals(expected))result.errors.push(`checkout bytes differ from Git snapshot: ${name}`);
      }catch{result.errors.push(`missing/non-regular checkout asset: ${name}`);}
    }
  }
  return {...result,ok:result.errors.length===0,ref,snapshot:source.snapshot,worktree_checked:checkWorktree};
}

export function refreshEvidence({repo=defaultRepo,ref='INDEX'}={}){
  const source=gitEvidence(repo,ref),names=entryPaths(source.manifest),listed=new Set(names),available=new Set(source.assetPaths);
  if(names.some(n=>!available.has(n))||source.assetPaths.some(n=>!listed.has(n)))throw Error('refuse refresh: manifest paths do not exactly cover Git evidence assets');
  const manifest=structuredClone(source.manifest),changed=[];
  for(const entry of manifest.entries){
    const bytes=source.readBytes(entry.path),sha=sha256(bytes);
    if(entry.sha256!==sha||entry.bytes!==bytes.length)changed.push(entry.path);
    entry.sha256=sha;entry.bytes=bytes.length;
  }
  manifest.byte_representation='Raw Git blob bytes; text uses LF according to .gitattributes';
  // Only metadata is written. Assets and historical measurements are never regenerated.
  writeFileSync(path.join(repo,MANIFEST),JSON.stringify(manifest,null,2)+'\n','utf8');
  return {ok:true,ref,snapshot:source.snapshot,entries:manifest.entries.length,changed};
}

function main(args){
  let repo=defaultRepo,ref='HEAD',write=false,checkWorktree=false;
  for(let i=0;i<args.length;i++){
    if(args[i]==='--repo')repo=path.resolve(args[++i]??'');
    else if(args[i]==='--ref')ref=args[++i];
    else if(args[i]==='--write')write=true;
    else if(args[i]==='--check-worktree')checkWorktree=true;
    else throw Error('usage: check-evidence-manifest.mjs [--repo DIR] [--ref HEAD|INDEX|COMMIT] [--check-worktree] [--write]');
  }
  if(write&&checkWorktree)throw Error('--write and --check-worktree are separate operations');
  const result=write?refreshEvidence({repo,ref}):verifyEvidence({repo,ref,checkWorktree});
  console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main(process.argv.slice(2));}catch(error){console.error(error.message);process.exitCode=1;}
}
