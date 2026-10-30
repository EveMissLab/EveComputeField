import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync,spawnSync } from 'node:child_process';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest } from './check-evidence-manifest.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),script=path.join(root,'scripts/check-evidence-manifest.mjs');
const sha=b=>createHash('sha256').update(b).digest('hex');
const manifest=bytes=>({schema:'ecf-public-research-evidence/v1',measurement_date:'2026-10-31',entries:[{path:'r2/figure.svg',sha256:sha(bytes),bytes:bytes.length,kind:'standalone SVG figure'}]});

test('CRLF-derived metadata fails on LF Git bytes; verifier does not normalize input',()=>{
  const lf=Buffer.from('<svg>\n<path/>\n</svg>\n'),crlf=Buffer.from(lf.toString().replace(/\n/g,'\r\n'));
  const wrong=validateManifest(manifest(crlf),()=>lf,['r2/figure.svg']);assert.equal(wrong.ok,false);assert.equal(wrong.errors.length,2);
  assert.equal(validateManifest(manifest(lf),()=>lf,['r2/figure.svg']).ok,true);
  assert.equal(validateManifest(manifest(lf),()=>crlf,['r2/figure.svg']).ok,false);
});

test('same-length content corruption, duplicate entries and missing coverage fail',()=>{
  const bytes=Buffer.from('<svg/>\n'),m=manifest(bytes),tampered=Buffer.from('<Svg/>\n');
  assert.equal(validateManifest(m,()=>tampered,['r2/figure.svg']).ok,false);
  assert.throws(()=>validateManifest({...m,entries:[...m.entries,...m.entries]},()=>bytes,['r2/figure.svg']),/duplicate/);
  assert.equal(validateManifest(m,()=>bytes,['r2/figure.svg','r2/unlisted.json']).ok,false);
  assert.equal(validateManifest(m,()=>bytes,[]).ok,false);
  assert.throws(()=>validateManifest({...m,entries:[{...m.entries[0],path:'../outside.svg'}]},()=>bytes,[]),/path/);
});

test('Git index normalization reproduces the release bug and raw checkout gate rejects CRLF',()=>{
  const base=path.join(root,'.evefield-local');mkdirSync(base,{recursive:true});const repo=mkdtempSync(path.join(base,'evidence-test-'));
  const git=(...args)=>execFileSync('git',['-c','core.autocrlf=false','-C',repo,...args],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  const cli=(...args)=>spawnSync(process.execPath,[script,'--repo',repo,'--ref','INDEX',...args],{encoding:'utf8',windowsHide:true});
  try{
    git('init','--quiet');mkdirSync(path.join(repo,'research/evidence/r2'),{recursive:true});
    writeFileSync(path.join(repo,'.gitattributes'),'* text=auto eol=lf\n');
    const asset=path.join(repo,'research/evidence/r2/figure.svg'),file=path.join(repo,'research/evidence/manifest.json'),crlf=Buffer.from('<svg>\r\n<path/>\r\n</svg>\r\n'),lf=Buffer.from('<svg>\n<path/>\n</svg>\n');
    writeFileSync(asset,crlf);writeFileSync(file,JSON.stringify(manifest(crlf),null,2)+'\n');git('add','.');
    assert.ok(git('show',':research/evidence/r2/figure.svg').equals(lf));
    const before=readFileSync(file),bad=cli();assert.equal(bad.status,1,bad.stderr);assert.ok(readFileSync(file).equals(before));
    const fixed=cli('--write');assert.equal(fixed.status,0,fixed.stderr);
    const updated=JSON.parse(readFileSync(file));assert.equal(updated.entries[0].sha256,sha(lf));assert.equal(updated.entries[0].bytes,lf.length);assert.equal(updated.measurement_date,'2026-10-31');assert.ok(readFileSync(asset).equals(crlf));
    git('add','research/evidence/manifest.json');assert.equal(cli().status,0);
    const checkout=cli('--check-worktree');assert.equal(checkout.status,1);assert.match(checkout.stdout,/checkout bytes differ/);
    writeFileSync(asset,lf);assert.equal(cli('--check-worktree').status,0);
    writeFileSync(asset,Buffer.from(lf.toString().replace('path','Path')));assert.equal(cli('--check-worktree').status,1);
  }finally{
    // Delete only the generated fixture under this repository's ignored runtime directory.
    const actual=realpathSync(repo),parent=realpathSync(base);
    assert.equal(path.dirname(actual),parent);assert.ok(path.basename(actual).startsWith('evidence-test-'));rmSync(actual,{recursive:true,force:true});
  }
});
