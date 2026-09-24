import test from 'node:test';
import assert from 'node:assert/strict';
import {isUiCheckStudy,collectionStorageKey,createSessionId,sessionMatchesPurpose} from '../src/ui-session.ts';
import {createBlockPlan,nextBlockQuestion} from '../src/core/height-block-study.ts';
import {releaseMock,mainPayload} from './fixtures/release-mock.mjs';
const uuid='e3db4d3e-8e68-4ff5-aeb7-e74f8f42fb42';
test('UI check has a recognizable, unique, resumable session ID and a separate local namespace',()=>{
 assert.equal(isUiCheckStudy({}),false);assert.equal(isUiCheckStudy({collectionPhase:'owner-ui-check-v1'}),true);
 assert.equal(createSessionId(true,uuid),'ui-check-'+uuid);assert.equal(createSessionId(false,uuid),uuid);
 assert.notEqual(createSessionId(true),createSessionId(true));
 assert.equal(sessionMatchesPurpose('ui-check-'+uuid,true),true);assert.equal(sessionMatchesPurpose(uuid,false),true);
 assert.equal(sessionMatchesPurpose(uuid,true),false);assert.equal(sessionMatchesPurpose('ui-check-'+uuid,false),false);
 assert.equal(sessionMatchesPurpose('ui-check-'+uuid+'-bad',true),false);assert.throws(()=>createSessionId(true,'invalid'));
 assert.notEqual(collectionStorageKey('main','v7',true),collectionStorageKey('main','v7',false));
});
test('test-prefixed session is stored as such in all three tabs; the prefix never bypasses closed intake',()=>{
 const plan=createBlockPlan(77),p={...mainPayload(nextBlockQuestion(plan,[]),plan),sessionId:createSessionId(true,uuid)};
 const closed=releaseMock({properties:{}});assert.throws(()=>closed.call('trial',p));assert.equal(closed.writes,0);
 const m=releaseMock();m.call('trial',p);m.call('trial',p);
 assert.equal(m.rows('Trials').length,1);assert.equal(m.rows('Runs').length,2);assert.equal(m.rows('Sessions').length,1);
 for(const tab of ['Trials','Runs','Sessions'])assert.ok(m.rows(tab).every(r=>r.sessionId===p.sessionId));
 assert.equal(m.rows('Sessions')[0].status,'started');assert.equal(m.rows('Sessions')[0].profileCompleted,true);
});
