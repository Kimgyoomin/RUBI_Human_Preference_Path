import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {createBlockPlan,nextBlockQuestion,BLOCK_PROTOCOL} from '../src/core/height-block-study.ts';
import {MAIN_ID,MAIN_SHEET,releaseMock,mainPayload} from './fixtures/release-mock.mjs';
const plan=createBlockPlan(33455718), first=mainPayload(nextBlockQuestion(plan,[]),plan);
test('main intake defaults closed; ping confirms only capability, not data or file IDs',()=>{
 const m=releaseMock({properties:{}}),r=m.call('ping',{experimentId:MAIN_ID,studyStatus:'released'});
 assert.equal(r.collectionOpen,false);assert.equal(r.releaseVersion,'isolated-main-collector-v8');assert.equal(r.datasetTag,'main-v1');assert.equal(r.schemaReady,true);
 assert.equal(m.writes,0);assert.doesNotMatch(JSON.stringify(r),/1Az6w|sessionId|participantId|trialRows/);
 assert.throws(()=>m.call('trial',first),/받지 않습니다/);assert.equal(m.writes,0);
});
test('pilot and main are pinned to different files; client-supplied destinations are ignored',()=>{
 const m=releaseMock();m.call('trial',{...first,spreadsheetId:'attacker-file',sheetName:'Other'});
 assert.ok(m.openedIds.length);assert.ok(m.openedIds.every(x=>x===MAIN_SHEET));assert.equal(m.rows('Trials').length,1);
 const old='1u7mXgUFagYepp1oOxVohs5x7i7bCfnBVZbQKKcwOYQA';const pilot=releaseMock({targetId:old});
 const r=pilot.call('ping',{experimentId:'rubi-hpp-block-pilot-v7',studyStatus:'draft'});assert.equal(r.datasetTag,'pilot');assert.ok(pilot.openedIds.every(x=>x===old));
 assert.throws(()=>m.call('ping',{experimentId:MAIN_ID,studyStatus:'draft'}));assert.throws(()=>pilot.call('ping',{experimentId:'rubi-hpp-block-pilot-v7',studyStatus:'released'}));
});
test('unauthenticated web requests cannot open, export, delete or select administration actions',()=>{
 const m=releaseMock({properties:{}});
 for(const kind of ['openMainCollection_','pauseMainCollection_','export','delete','inspectMainCollection_'])assert.throws(()=>m.call(kind,{experimentId:MAIN_ID,studyStatus:'released'}));
 assert.equal(m.writes,0);assert.equal(m.properties.size,0);
 vm.runInContext('openMainCollection_()',m.context);assert.equal(m.properties.get('RUBI_MAIN_COLLECTION_OPEN'),'true');
 vm.runInContext('pauseMainCollection_()',m.context);assert.equal(m.properties.get('RUBI_MAIN_COLLECTION_OPEN'),'false');
});
test('main rejects modified study, skipped sequence, forged history, policy and route length before writing',()=>{
 const invalid=[{expectedTrials:4},{protocolVersion:'old'},{isPractice:true},{consent:false},{scenario:{height:.13,detour:.4,speed:.5}},
   {trialSequence:2},{labelConditionVersion:'other'},{queryReason:'invented'},{hashes:{}},{questionPlan:{...plan,seed:plan.seed+1}},
   {queryContext:{...first.queryContext,state:'invented'}},{runs:{...first.runs,direct:{...first.runs.direct,plannedLength:9}}}];
 for(const change of invalid){const m=releaseMock();assert.throws(()=>m.call('trial',{...first,...change}));assert.equal(m.writes,0);}
 const m=releaseMock();m.call('trial',first);const q=nextBlockQuestion(plan,[first]);
 assert.throws(()=>m.call('trial',{...mainPayload(q,plan),preProfile:{...first.preProfile,roboticsRelatedExperience:'yes'}}));assert.equal(m.rows('Trials').length,1);
});
test('full main session retains all 16 raw answers and 32 links, including skip, then completes',()=>{
 const m=releaseMock(),answers=[];
 const finish={...first.preProfile,experimentId:MAIN_ID,studyStatus:'released',protocolVersion:BLOCK_PROTOCOL,sessionId:first.sessionId,participantId:first.participantId,expectedTrials:16,consent:true};
 for(let i=0;i<16;i++){
   const p=mainPayload(nextBlockQuestion(plan,answers),plan);if(i===6){p.choice='skip';p.skipReason='insufficient_information';}
   m.call('trial',p);assert.ok(m.call('trial',p).duplicate);answers.push(p);
   if(i<15)assert.throws(()=>m.call('profile',finish));
 }
 assert.equal(m.rows('Trials').length,16);assert.equal(m.rows('Runs').length,32);assert.equal(m.rows('Sessions').length,1);
 assert.ok(m.rows('Trials').every(r=>r.saveState==='complete'));m.call('profile',finish);assert.equal(m.rows('Sessions')[0].status,'completed');
 assert.ok(m.call('profile',finish).duplicate);m.call('trial',first);assert.equal(m.rows('Sessions')[0].status,'completed');
});
test('main repairs failure before/after each write with original ID and does not double-append',()=>{
 const good=releaseMock();good.call('trial',first);
 for(const when of ['before','after'])for(let failAt=1;failAt<=good.writes;failAt++){
   const m=releaseMock({failAt,when});assert.throws(()=>m.call('trial',first));assert.equal(m.held,false);m.call('trial',first);
   assert.equal(m.rows('Trials').length,1);assert.equal(m.rows('Runs').length,2);assert.equal(m.rows('Sessions').length,1);assert.equal(m.rows('Trials')[0].saveState,'complete');
 }
});
test('new main configuration does not silently activate or overwrite current pilot',()=>{
 const pilot=JSON.parse(fs.readFileSync('public/study.json','utf8')),main=JSON.parse(fs.readFileSync('config/study.main.json','utf8'));
 assert.equal(pilot.status,'draft');assert.notEqual(pilot.id,main.id);assert.equal(main.id,MAIN_ID);assert.equal(main.requiredReleaseVersion,'isolated-main-collector-v8');
 assert.deepEqual(main.heightBlocks,pilot.heightBlocks);assert.deepEqual(main.introduction,pilot.introduction);
});
test('only doGet and doPost are exposed as public Apps Script RPC functions',()=>{
 const m=releaseMock({properties:{}});
 const exposed=Object.keys(m.context).filter(k=>typeof m.context[k]==='function'&&!k.endsWith('_')).sort();
 assert.deepEqual(exposed,['doGet','doPost']);
 assert.equal(typeof m.context.openMainCollection,'undefined');
});
