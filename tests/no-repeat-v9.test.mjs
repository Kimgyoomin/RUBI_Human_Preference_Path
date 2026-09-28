import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as n from '../src/core/height-block-study-v9.ts';
import * as old from '../src/core/height-block-study.ts';
import {noRepeatMock,noRepeatPayload} from './fixtures/no-repeat-mock.mjs';
import {mainPayload,MAIN_ID} from './fixtures/release-mock.mjs';
import {chooseStudy} from '../src/runtime/study-selection.ts';
import {collectionStorageKey} from '../src/ui-session.ts';
const add=(p,a,c)=>{const q=n.nextBlockQuestion(p,a);a.push({submissionId:'s-'+a.length,trialSequence:q.sequence,scenario:{height:q.heightCm/100,detour:q.detourMm/1000},choice:c});return q;};
test('v9: all 81 reply sequences x 64 seeds use four unique distances, including skips/conflicts',()=>{
 for(let seed=0;seed<64;seed++)for(let code=0;code<81;code++){
  const p=n.createBlockPlan(seed,[9]),a=[],seen=new Set();let x=code;
  for(let i=0;i<4;i++){
   const q=n.nextBlockQuestion(p,a);assert.ok(!seen.has(q.detourMm));seen.add(q.detourMm);
   assert.deepEqual(n.nextBlockQuestion(structuredClone(p),structuredClone(a)),q);
   add(p,a,['direct','detour','skip'][x%3]);x=Math.floor(x/3);
  }
  assert.equal(n.nextBlockQuestion(p,a),null);assert.equal(a.length,4);
 }
});
test('v9 endpoint, midpoint, one-sided and conflict probes have explicit non-repeated rules',()=>{
 for(const c of ['direct','detour']){
  const p=n.createBlockPlan(0,[9]),a=[];for(let i=0;i<4;i++)add(p,a,c);
  assert.deepEqual(a.slice(2).map(x=>x.scenario.detour),c==='direct'?[.6,.8]:[2.2,2]);
 }
 const p=n.createBlockPlan(0,[9]),a=[];
 for(let i=0;i<2;i++){const q=n.nextBlockQuestion(p,a);add(p,a,q.detourMm===400?'detour':'direct');}
 assert.equal(n.nextBlockQuestion(p,a).detourMm,1400);add(p,a,'direct');assert.ok([800,1000].includes(n.nextBlockQuestion(p,a).detourMm));
 const b=[];for(let i=0;i<2;i++){const q=n.nextBlockQuestion(p,b);add(p,b,q.detourMm===400?'direct':'detour');}
 assert.equal(n.nextBlockQuestion(p,b).reason,'unseen_conflict_probe');assert.equal(n.nextBlockQuestion(p,b).detourMm,1400);
});
test('v9 stays at 16, balanced heights/starts/A-B; forged plan and distance rejected',()=>{
 for(let seed=0;seed<50;seed++){
  const p=n.createBlockPlan(seed),a=[];assert.ok(n.validBlockPlan(p));assert.equal(p.blocks.filter(b=>b.first==='low').length,2);
  for(const b of p.blocks)assert.equal(b.aRoutes.filter(r=>r==='direct').length,2);
  for(let i=0;i<16;i++)add(p,a,i%3===0?'skip':i%2?'direct':'detour');
  for(let i=0;i<4;i++)assert.equal(new Set(a.slice(i*4,i*4+4).map(x=>x.scenario.detour)).size,4);
  assert.equal(n.nextBlockQuestion(p,a),null);
  const bad=structuredClone(a);bad[1].scenario.detour=bad[0].scenario.detour;assert.throws(()=>n.nextBlockQuestion(p,bad));
 }
});
test('collector v9 preserves v7 handshake, open property, main destination and no public admin RPC',()=>{
 const m=noRepeatMock(),p={experimentId:MAIN_ID,studyStatus:'released'};
 assert.equal(m.call('ping',p).releaseVersion,'isolated-main-collector-v8');
 assert.equal(m.call('ping',{...p,protocolVersion:n.BLOCK_PROTOCOL}).releaseVersion,'no-repeat-collector-v9');
 assert.equal(m.call('ping',{...p,protocolVersion:n.BLOCK_PROTOCOL}).collectionOpen,true);
 const closed=noRepeatMock({properties:{}});assert.equal(closed.call('ping',{...p,protocolVersion:n.BLOCK_PROTOCOL}).collectionOpen,false);assert.equal(closed.writes,0);
 assert.deepEqual(Object.keys(m.context).filter(k=>typeof m.context[k]==='function'&&!k.endsWith('_')).sort(),['doGet','doPost']);
});
function complete(m,mod,payload){
 const p=mod.createBlockPlan(32),a=[];
 for(let i=0;i<16;i++){const q=mod.nextBlockQuestion(p,a),r=payload(q,p);if(i===6){r.choice='skip';r.skipReason='insufficient_information';}m.call('trial',r);m.call('trial',r);a.push(r);}
 const last=a[15];m.call('profile',{experimentId:MAIN_ID,studyStatus:'released',protocolVersion:mod.BLOCK_PROTOCOL,sessionId:last.sessionId,participantId:last.participantId,expectedTrials:16,consent:true,...last.preProfile});
 assert.equal(m.rows('Trials').length,16);assert.equal(m.rows('Runs').length,32);assert.equal(m.rows('Sessions')[0].status,'completed');return a;
}
test('full v9 and legacy v7 sessions both complete on the same new collector',()=>{
 complete(noRepeatMock(),n,noRepeatPayload);complete(noRepeatMock(),old,mainPayload);
});
test('v9 repairs failures before/after writes, rejects repeat conditions and cross-version edits',()=>{
 const p=n.createBlockPlan(0),first=noRepeatPayload(n.nextBlockQuestion(p,[]),p),good=noRepeatMock();good.call('trial',first);
 for(const when of ['before','after'])for(let failAt=1;failAt<=good.writes;failAt++){
  const m=noRepeatMock({failAt,when});assert.throws(()=>m.call('trial',first));m.call('trial',first);assert.equal(m.rows('Trials').length,1);assert.equal(m.rows('Runs').length,2);assert.equal(m.rows('Trials')[0].saveState,'complete');
 }
 const q=n.nextBlockQuestion(p,[first]),second=noRepeatPayload(q,p);const bad=structuredClone(second);bad.scenario.detour=first.scenario.detour;bad.runs.detour.plannedLength=6+bad.scenario.detour;
 assert.throws(()=>good.call('trial',bad));assert.throws(()=>good.call('trial',{...second,protocolVersion:old.BLOCK_PROTOCOL}));assert.throws(()=>good.call('profile',{...first,...first.preProfile,protocolVersion:old.BLOCK_PROTOCOL}));
 good.call('trial',second);assert.equal(good.rows('Trials').length,2);
});
test('old browser reload preserves unfinished v7; current/new and legacy storage stay separate',()=>{
 const current=JSON.parse(fs.readFileSync('public/study.ui-check-v9.json')),legacy=JSON.parse(fs.readFileSync('public/study.legacy-v7.json'));
 const map=new Map(),store={getItem:k=>map.get(k)??null};
 const key=s=>collectionStorageKey(s.id,s.protocolVersion,true);
 assert.equal(chooseStudy(current,legacy,store,null),current);
 const raw=JSON.stringify({id:'legacy',consent:true,index:9,responses:Array(9).fill({}),complete:false});map.set(key(legacy),raw);
 assert.equal(chooseStudy(current,legacy,store,null),legacy);assert.equal(map.get(key(legacy)),raw);
 assert.equal(chooseStudy(current,legacy,store,'current'),current);
 assert.notEqual(key(current),key(legacy));map.set(key(current),JSON.stringify({consent:true,complete:false}));
 assert.equal(chooseStudy(current,legacy,store,null),current);assert.equal(chooseStudy(current,legacy,store,'legacy-v7'),legacy);
 map.set(key(current),'bad json');assert.throws(()=>chooseStudy(current,legacy,store,null));assert.equal(map.get(key(legacy)),raw);
});
