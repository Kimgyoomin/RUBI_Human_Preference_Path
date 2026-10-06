import test from 'node:test';
import assert from 'node:assert/strict';
import * as n from '../src/core/height-block-study-v9.ts';
import {storageFinalizeMock} from './fixtures/storage-finalize-mock.mjs';
import {storageFastMock} from './fixtures/storage-fast-mock.mjs';
import {noRepeatPayload} from './fixtures/no-repeat-mock.mjs';
import {MAIN_ID} from './fixtures/release-mock.mjs';

function scopedPayload(q,plan,scope='a'){
  const p=structuredClone(noRepeatPayload(q,plan));
  p.sessionId=`pilot-v12-${scope}`;
  p.participantId=`person-v12-${scope}`;
  p.submissionId=`sub-v12-${scope}-${q.sequence}`;
  p.trialId=`trial-v12-${scope}-${q.sequence}`;
  p.runs.direct.id=`run-v12-${scope}-${q.sequence}-direct`;
  p.runs.detour.id=`run-v12-${scope}-${q.sequence}-detour`;
  return p;
}
function profilePayload(last){
  return {
    experimentId:MAIN_ID,studyStatus:'released',protocolVersion:n.BLOCK_PROTOCOL,
    sessionId:last.sessionId,participantId:last.participantId,expectedTrials:16,consent:true,
    profileSchemaVersion:'pre-profile-plain-v2',...last.preProfile
  };
}
function completeSession(m,scope='full'){
  const plan=n.createBlockPlan(900+scope.length),history=[],payloads=[];
  for(let i=0;i<16;i++){
    const q=n.nextBlockQuestion(plan,history),p=scopedPayload(q,plan,scope);
    if(i===5){p.choice='skip';p.skipReason='insufficient_information';}
    m.call('trial',p);history.push(p);payloads.push(p);
  }
  return payloads;
}
function removeTrialSequence(m,sid,seq){
  const h=m.sheets.Trials.data[0],s=h.indexOf('sessionId'),q=h.indexOf('trialSequence');
  m.sheets.Trials.data=[h,...m.sheets.Trials.data.slice(1).filter(r=>!(r?.[s]===sid&&Number(r?.[q])===seq))];
}

test('v12 keeps public v9 handshake and advertises batch-finalize marker',()=>{
  const m=storageFinalizeMock();
  const r=m.call('ping',{experimentId:MAIN_ID,studyStatus:'released',protocolVersion:n.BLOCK_PROTOCOL});
  assert.equal(r.releaseVersion,'no-repeat-collector-v9');
  assert.equal(r.storageHotfixVersion,'fast-batch-finalize-v12');
  assert.equal(r.collectionOpen,true);
});

test('finalize replaces v11 per-link lookup loop with bounded bulk reads',()=>{
  const v11=storageFastMock(),a11=completeSession(v11,'read-compare-11'),last11=a11.at(-1);
  const r11=v11.reads;v11.call('profile',profilePayload(last11));const d11=v11.reads-r11;

  const v12=storageFinalizeMock(),a12=completeSession(v12,'read-compare-12'),last12=a12.at(-1);
  const r12=v12.reads;v12.call('profile',profilePayload(last12));const d12=v12.reads-r12;

  assert.equal(v12.rows('Sessions')[0].status,'completed');
  assert.ok(d11>40,`expected old finalize to be read-heavy, got ${d11}`);
  assert.ok(d12<=16,`expected batch finalize bounded reads, got ${d12}`);
  assert.ok(d12<d11/3,`expected >=3x fewer reads; v11=${d11}, v12=${d12}`);
});

test('transient Spreadsheet open errors retry without creating duplicate data',()=>{
  const m=storageFinalizeMock({openFailCount:2}),plan=n.createBlockPlan(31),p=scopedPayload(n.nextBlockQuestion(plan,[]),plan,'open-retry');
  m.call('trial',p);
  assert.ok(m.openAttempts>=3);
  assert.equal(m.sleeps,2);
  assert.equal(m.rows('Trials').length,1);
  assert.equal(m.rows('Runs').length,2);
  assert.equal(m.rows('Sessions').length,1);
});

test('transient read error during finalize is retried and completion still succeeds',()=>{
  const m=storageFinalizeMock(),all=completeSession(m,'read-retry'),last=all.at(-1);
  const sleeps=m.sleeps;
  m.failNextReads(1);
  m.call('profile',profilePayload(last));
  assert.ok(m.sleeps>sleeps);
  assert.equal(m.rows('Sessions')[0].status,'completed');
  assert.equal(Number(m.rows('Sessions')[0].savedTrials),16);
});

test('batch finalize still refuses missing Trial and missing Run',()=>{
  const m=storageFinalizeMock(),all=completeSession(m,'integrity'),last=all.at(-1);
  removeTrialSequence(m,last.sessionId,16);
  assert.throws(()=>m.call('profile',profilePayload(last)),/아직 저장되지 않은 문항/);
  m.call('trial',last);
  const missingRun=m.sheets.Runs.data.pop();
  assert.throws(()=>m.call('profile',profilePayload(last)),/실행 기록이 누락/);
  m.sheets.Runs.data.push(missingRun);
  m.call('profile',profilePayload(last));
  assert.equal(m.rows('Sessions')[0].status,'completed');
});

test('v12 remains idempotent when completion response is retried',()=>{
  const m=storageFinalizeMock(),all=completeSession(m,'duplicate-profile'),last=all.at(-1);
  const first=m.call('profile',profilePayload(last));
  const second=m.call('profile',profilePayload(last));
  assert.equal(first.duplicate,false);
  assert.equal(second.duplicate,true);
  assert.equal(m.rows('Sessions').length,1);
  assert.equal(m.rows('Sessions')[0].status,'completed');
});
