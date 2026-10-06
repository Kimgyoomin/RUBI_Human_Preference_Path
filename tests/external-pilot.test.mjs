import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {collectionPurpose,collectionStorageKey,createSessionId,sessionMatchesPurpose,EXTERNAL_PILOT_PHASE,isExternalPilotStudy} from '../src/ui-session.ts';
import {chooseStudy} from '../src/runtime/study-selection.ts';
import * as v9 from '../src/core/height-block-study-v9.ts';
import {noRepeatMock,noRepeatPayload} from './fixtures/no-repeat-mock.mjs';
const current=JSON.parse(fs.readFileSync('public/study.json'));
const check=JSON.parse(fs.readFileSync('public/study.ui-check-v9.json'));
const legacy=JSON.parse(fs.readFileSync('public/study.legacy-v7.json'));
const uuid='00000000-0000-4000-8000-000000000012';
test('external launch changes purpose, never questions, API, policies or collector requirements',()=>{
 const {collectionPhase:cp,...c}=current,{collectionPhase:dp,...d}=check;
 assert.equal(cp,EXTERNAL_PILOT_PHASE);assert.equal(cp,'external-pilot-v2');assert.equal(dp,'owner-ui-check-v1');assert.deepEqual(c,d);
 assert.equal(collectionPurpose(current),EXTERNAL_PILOT_PHASE);assert.ok(isExternalPilotStudy(current));
 assert.notEqual(collectionStorageKey(current.id,current.protocolVersion,EXTERNAL_PILOT_PHASE),collectionStorageKey(check.id,check.protocolVersion,true));
 assert.equal(createSessionId(EXTERNAL_PILOT_PHASE,uuid),'pilot-'+uuid);
 assert.ok(sessionMatchesPurpose('pilot-'+uuid,EXTERNAL_PILOT_PHASE));
 assert.ok(!sessionMatchesPurpose('ui-check-'+uuid,EXTERNAL_PILOT_PHASE));
 assert.ok(!sessionMatchesPurpose('pilot-'+uuid,true));
 assert.throws(()=>collectionPurpose({collectionPhase:'typo'}));
});
test('v2 rotates only local browser storage; old v1 state remains untouched and is never resumed',()=>{
 const map=new Map(),store={getItem:k=>map.get(k)??null};
 const oldPilotKey=`RUBI_Human_Preference_Path:${current.id}:${current.protocolVersion}:external-pilot-v1`;
 const oldRaw=JSON.stringify({id:'pilot-'+uuid,consent:true,complete:false,responses:[{}]});
 map.set(oldPilotKey,oldRaw);
 assert.equal(chooseStudy(current,legacy,store,null),current);
 assert.equal(map.get(oldPilotKey),oldRaw);
 assert.equal(map.get(collectionStorageKey(current.id,current.protocolVersion,EXTERNAL_PILOT_PHASE)),undefined);
});
test('no automatic migration of old developer sessions; explicit test route still resumes',()=>{
 const map=new Map(),store={getItem:k=>map.get(k)??null};
 const oldRaw=JSON.stringify({id:'ui-check-'+uuid,consent:true,complete:false,responses:[{}]});
 for(const s of [check,legacy])map.set(collectionStorageKey(s.id,s.protocolVersion,true),oldRaw);
 assert.equal(chooseStudy(current,legacy,store,null),current);
 assert.equal(chooseStudy(current,legacy,store,'legacy-v7'),legacy);
 assert.equal(chooseStudy(check,legacy,store,'current'),check);
 assert.equal(map.get(collectionStorageKey(check.id,check.protocolVersion,true)),oldRaw);
});
test('unchanged deployed v9 collector accepts pilot-labelled 16/32 completion and rejects closed intake',()=>{
 const m=noRepeatMock(),plan=v9.createBlockPlan(45),history=[];
 for(let i=0;i<16;i++){
  const p={...noRepeatPayload(v9.nextBlockQuestion(plan,history),plan),sessionId:createSessionId(EXTERNAL_PILOT_PHASE,uuid)};
  m.call('trial',p);m.call('trial',p);history.push(p);
 }
 const p=history.at(-1);
 m.call('profile',{experimentId:p.experimentId,studyStatus:'released',protocolVersion:p.protocolVersion,sessionId:p.sessionId,participantId:p.participantId,consent:true,expectedTrials:16,...p.preProfile});
 assert.equal(m.rows('Trials').length,16);assert.equal(m.rows('Runs').length,32);assert.equal(m.rows('Sessions')[0].status,'completed');
 for(const t of ['Trials','Runs','Sessions'])assert.ok(m.rows(t).every(r=>r.sessionId==='pilot-'+uuid));
 const closed=noRepeatMock({properties:{}});assert.throws(()=>closed.call('trial',history[0]));assert.equal(closed.writes,0);
});
