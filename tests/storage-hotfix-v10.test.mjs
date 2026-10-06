import test from 'node:test';
import assert from 'node:assert/strict';
import * as n from '../src/core/height-block-study-v9.ts';
import * as legacy from '../src/core/height-block-study.ts';
import {storageHotfixMock} from './fixtures/storage-hotfix-mock.mjs';
import {noRepeatPayload} from './fixtures/no-repeat-mock.mjs';
import {mainPayload,MAIN_ID} from './fixtures/release-mock.mjs';

function scopedPayload(q,plan,scope='a'){
  const p=structuredClone(noRepeatPayload(q,plan));
  p.sessionId=`pilot-hotfix-${scope}`;
  p.participantId=`person-${scope}`;
  p.submissionId=`sub-${scope}-${q.sequence}`;
  p.trialId=`trial-${scope}-${q.sequence}`;
  p.runs.direct.id=`run-${scope}-${q.sequence}-direct`;
  p.runs.detour.id=`run-${scope}-${q.sequence}-detour`;
  return p;
}
function profilePayload(last){
  return {
    experimentId:MAIN_ID,studyStatus:'released',protocolVersion:n.BLOCK_PROTOCOL,
    sessionId:last.sessionId,participantId:last.participantId,expectedTrials:16,consent:true,
    profileSchemaVersion:'pre-profile-plain-v2',...last.preProfile
  };
}
function fullSession(m,scope='a'){
  const plan=n.createBlockPlan(100+scope.length),history=[],payloads=[];
  for(let i=0;i<16;i++){
    const q=n.nextBlockQuestion(plan,history),p=scopedPayload(q,plan,scope);
    if(i%5===2){p.choice='skip';p.skipReason='insufficient_information';}
    m.call('trial',p);history.push(p);payloads.push(p);
  }
  return payloads;
}
function col(m,sheet,name){return m.sheets[sheet].data[0].indexOf(name);}
function sessionRow(m,sid){return m.sheets.Sessions.data.findIndex((r,i)=>i>0&&r?.[0]===sid);}

test('v10 ping keeps the deployed v9 handshake and reports the storage hotfix',()=>{
  const m=storageHotfixMock(),p={experimentId:MAIN_ID,studyStatus:'released',protocolVersion:n.BLOCK_PROTOCOL};
  const r=m.call('ping',p);
  assert.equal(r.releaseVersion,'no-repeat-collector-v9');
  assert.equal(r.collectorVersion,'repairable-block-collector-v7');
  assert.equal(r.storageHotfixVersion,'transactional-sheets-v10');
  assert.equal(r.collectionOpen,true);
});

test('same-ID retry repairs failures before/after every write without duplicate Trial/Run/Session rows',()=>{
  const plan=n.createBlockPlan(3),first=scopedPayload(n.nextBlockQuestion(plan,[]),plan,'repair');
  const probe=storageHotfixMock();probe.call('trial',first);const nWrites=probe.writes;
  assert.ok(nWrites>0);
  for(const when of ['before','after'])for(let failAt=1;failAt<=nWrites;failAt++){
    const m=storageHotfixMock({failAt,when});
    assert.throws(()=>m.call('trial',first));
    assert.equal(m.held,false);
    m.call('trial',first);
    assert.equal(m.rows('Trials').length,1,`failAt=${failAt} ${when}`);
    assert.equal(m.rows('Runs').length,2,`failAt=${failAt} ${when}`);
    assert.equal(m.rows('Sessions').length,1,`failAt=${failAt} ${when}`);
    assert.equal(m.rows('Trials')[0].saveState,'complete');
    assert.equal(Number(m.rows('Sessions')[0].savedTrials),1);
  }
});

test('observed production failure shape (Runs/Session exist but Trial vanished) is repaired on same pending payload',()=>{
  const plan=n.createBlockPlan(4),first=scopedPayload(n.nextBlockQuestion(plan,[]),plan,'missing-trial');
  const m=storageHotfixMock();m.call('trial',first);
  const header=[...m.sheets.Trials.data[0]];
  m.sheets.Trials.data=[header];
  assert.equal(m.rows('Trials').length,0);
  assert.equal(m.rows('Runs').length,2);
  assert.equal(Number(m.rows('Sessions')[0].savedTrials),1);
  m.call('trial',first);
  assert.equal(m.rows('Trials').length,1);
  assert.equal(m.rows('Runs').length,2);
  assert.equal(m.rows('Trials')[0].saveState,'complete');
  assert.equal(Number(m.rows('Sessions')[0].savedTrials),1);
});

test('missing final Trial with all 32 Runs cannot complete, then same-ID retry repairs it and completion succeeds',()=>{
  const m=storageHotfixMock(),payloads=fullSession(m,'final-repair'),last=payloads.at(-1);
  assert.equal(m.rows('Trials').length,16);assert.equal(m.rows('Runs').length,32);
  const trialHeader=[...m.sheets.Trials.data[0]],seqCol=trialHeader.indexOf('trialSequence');
  m.sheets.Trials.data=[trialHeader,...m.sheets.Trials.data.slice(1).filter(r=>Number(r[seqCol])!==16)];
  const sr=sessionRow(m,last.sessionId);m.sheets.Sessions.data[sr][col(m,'Sessions','status')]='started';
  m.sheets.Sessions.data[sr][col(m,'Sessions','savedTrials')]=16;
  assert.equal(m.rows('Trials').length,15);assert.equal(m.rows('Runs').length,32);
  assert.throws(()=>m.call('profile',profilePayload(last)),/아직 저장되지 않은 문항/);
  m.call('trial',last);
  assert.equal(m.rows('Trials').length,16);assert.equal(m.rows('Runs').length,32);
  assert.equal(Number(m.rows('Sessions')[0].savedTrials),16);
  m.call('profile',profilePayload(last));
  assert.equal(m.rows('Sessions')[0].status,'completed');
});

test('completion requires exact 1..16 complete Trials and both linked Runs for every Trial',()=>{
  const m=storageHotfixMock(),payloads=fullSession(m,'completion'),last=payloads.at(-1);
  const runsHeader=[...m.sheets.Runs.data[0]],lastRun=m.sheets.Runs.data.pop();
  assert.throws(()=>m.call('profile',profilePayload(last)),/실행 기록이 누락/);
  m.sheets.Runs.data.push(lastRun);
  m.call('profile',profilePayload(last));
  assert.equal(m.rows('Sessions')[0].status,'completed');
  assert.equal(Number(m.rows('Sessions')[0].savedTrials),16);
  assert.equal(m.call('profile',profilePayload(last)).duplicate,true);
  assert.deepEqual(m.sheets.Runs.data[0],runsHeader);
});

test('lock contention is retryable and never advances server state before the lock is acquired',()=>{
  const plan=n.createBlockPlan(7),first=scopedPayload(n.nextBlockQuestion(plan,[]),plan,'lock');
  const m=storageHotfixMock({lockFailCount:1});
  assert.throws(()=>m.call('trial',first),/저장소가 사용 중/);
  assert.equal(m.rows('Trials').length,0);assert.equal(m.rows('Runs').length,0);assert.equal(m.rows('Sessions').length,0);
  m.call('trial',first);
  assert.equal(m.rows('Trials').length,1);assert.equal(m.rows('Runs').length,2);assert.equal(m.rows('Sessions').length,1);
  assert.equal(m.lockAttempts,2);
});

test('multi-session stress appends distinct rows without overwriting another participant',()=>{
  const m=storageHotfixMock(),count=64;
  for(let i=0;i<count;i++){
    const plan=n.createBlockPlan(i),q=n.nextBlockQuestion(plan,[]),p=scopedPayload(q,plan,`stress-${i}`);
    m.call('trial',p);
  }
  assert.equal(m.rows('Trials').length,count);
  assert.equal(m.rows('Runs').length,count*2);
  assert.equal(m.rows('Sessions').length,count);
  assert.equal(new Set(m.rows('Trials').map(r=>r.submissionId)).size,count);
  assert.equal(new Set(m.rows('Sessions').map(r=>r.sessionId)).size,count);
});

test('legacy v7 remains routed through the existing collector unchanged',()=>{
  const m=storageHotfixMock(),plan=legacy.createBlockPlan(9),q=legacy.nextBlockQuestion(plan,[]),p=mainPayload(q,plan);
  const r=m.call('trial',p);
  assert.equal(r.releaseVersion,'isolated-main-collector-v8');
  assert.equal(m.rows('Trials').length,1);
  assert.equal(m.rows('Runs').length,2);
});
