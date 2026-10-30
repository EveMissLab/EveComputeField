import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {verify,refreshIndex} from './check-source-manifest.mjs';

test('source manifest binds exact staged Git bytes and checkout LF bytes',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'ecf-src-manifest-'));
  const g=(...args)=>execFileSync('git',['-c','core.autocrlf=false','-C',dir,...args],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  try{
    g('init','--quiet');mkdirSync(path.join(dir,'docs'));
    writeFileSync(path.join(dir,'.gitattributes'),'* text=auto eol=lf\n');
    writeFileSync(path.join(dir,'docs','sample.txt'),'A\r\nB\r\n');
    writeFileSync(path.join(dir,'MANIFEST_SHA256.txt'),'# Current published source/evidence tree; excludes SHA256 manifest files.\n');
    g('add','.');
    assert.equal(refreshIndex({repo:dir}).tracked_files,2);
    g('add','MANIFEST_SHA256.txt');
    assert.equal(verify({repo:dir,ref:'INDEX'}).ok,true);
    assert.equal(verify({repo:dir,ref:'INDEX',checkWorktree:true}).ok,false);
    writeFileSync(path.join(dir,'docs','sample.txt'),'A\nB\n');
    assert.equal(verify({repo:dir,ref:'INDEX',checkWorktree:true}).ok,true);
    writeFileSync(path.join(dir,'docs','sample.txt'),'A\nC\n');
    assert.equal(verify({repo:dir,ref:'INDEX',checkWorktree:true}).ok,false);
    assert.match(readFileSync(path.join(dir,'MANIFEST_SHA256.txt'),'utf8'),/docs\/sample\.txt/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
