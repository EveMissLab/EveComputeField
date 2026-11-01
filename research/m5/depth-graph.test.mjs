import test from 'node:test';
import assert from 'node:assert/strict';
import {DepthExcitationGraph} from './depth-graph.mjs';

const B=x=>Buffer.from(String(x),'utf8');
const nodes=[
  {id:'waterfall',role:'source',ordinal:0,depends_on:[]},
  {id:'tide',role:'source',ordinal:0,depends_on:[]},
  {id:'river.1',role:'compute',ordinal:1,depends_on:['waterfall']},
  {id:'ocean.1',role:'compute',ordinal:1,depends_on:['tide']},
  {id:'river.2',role:'compute',ordinal:2,depends_on:['river.1']},
  {id:'river.3',role:'compute',ordinal:3,depends_on:['river.2']},
  {id:'svg.1',role:'observer',ordinal:1,depends_on:['river.1','ocean.1']},
  {id:'svg.3',role:'observer',ordinal:3,depends_on:['river.3','ocean.1']},
];
const create=()=>new DepthExcitationGraph({nodes,compute:async (node,input)=>
  B(`${node.id}(${input.map(x=>x.toString()).join(',')})`)});

test('ODTS depth-priority READY may compute ordinal 3 before ordinal 1 observer',async()=>{
  const g=create();g.setSource('waterfall',B('1'));
  g.setSource('tide',B('0'));
  const work=await g.computeBudget(30),names=work.map(x=>x.id);
  assert.equal(names.length,6);
  assert.ok(names.indexOf('river.3')<names.indexOf('svg.1'));
  assert.equal(g.auditReady('svg.3'),true);
  assert.equal(g.stats.materialized,8);
});

test('declared complete influence cone recomputes only downstream, global always falls back',async()=>{
  const g=create();g.setSource('waterfall',B('1'));
  g.setSource('tide',B('0'));await g.computeBudget(30);
  const ocean=g.get('ocean.1').digest;
  const d=g.setSource('waterfall',B('2'),{influence:'declared'});
  assert.equal(d.invalidated,5); // river.1, river.2, river.3, svg.1, svg.3
  assert.equal(g.get('ocean.1').digest,ocean);
  assert.deepEqual((await g.computeBudget(30)).length,5);
  const global=g.setSource('waterfall',B('3'),{influence:'global'});
  assert.equal(global.invalidated,6);
  assert.equal(g.get('ocean.1'),null);
});

test('source equality avoids recompute; revision, invalid dependency, cycle and quota fail closed',async()=>{
  const g=create();g.setSource('waterfall',B('1'));g.setSource('tide',B('0'));await g.computeBudget(30);
  assert.equal(g.setSource('waterfall',B('1'),{influence:'declared'}).changed,false);
  assert.equal(g.setWorldRevision('world-v2'),6);
  assert.equal(g.get('waterfall')?.payload.toString(),'1');
  assert.throws(()=>new DepthExcitationGraph({nodes:[{id:'a',role:'compute',ordinal:1,depends_on:['b']},
    {id:'b',role:'compute',ordinal:1,depends_on:['a']}],compute:()=>B('x')}),/cyclic/);
  assert.throws(()=>new DepthExcitationGraph({nodes:[{id:'a',role:'compute',ordinal:1,depends_on:['missing']}],compute:()=>B('x')}),/missing/);
  const tiny=new DepthExcitationGraph({nodes:[{id:'a',role:'source',ordinal:0,depends_on:[]},
    {id:'b',role:'compute',ordinal:1,depends_on:['a']}],compute:()=>B('too-long'),maxBytes:5});
  tiny.setSource('a',B('x'));await assert.rejects(tiny.computeBudget(1),/budget/);
  assert.equal(tiny.get('b'),null);
  assert.equal(g.auditReady('river.1'),false);
});


test('in-flight async compute forbids source mutation and preserves accepted state',async()=>{
  let release,entered;
  const gate=new Promise(resolve=>release=resolve);
  const arrived=new Promise(resolve=>entered=resolve);
  const g=new DepthExcitationGraph({nodes:[
    {id:'a',role:'source',ordinal:0,depends_on:[]},
    {id:'b',role:'compute',ordinal:1,depends_on:['a']}],
    compute:async (_node,inputs)=>{entered();await gate;return B(inputs[0].toString()+'-verified');}});
  g.setSource('a',B('first'),{influence:'declared'});
  const task=g.computeBudget(1);await arrived;
  assert.throws(()=>g.setSource('a',B('changed')),/in progress/);
  assert.throws(()=>g.invalidate(['a']),/in progress/);
  release();await task;
  assert.equal(g.get('b').payload.toString(),'first-verified');
});
