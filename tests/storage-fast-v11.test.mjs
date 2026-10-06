import test from 'node:test';
import assert from 'node:assert/strict';
import * as n from '../src/core/height-block-study-v9.ts';
import * as legacy from '../src/core/height-block-study.ts';
import {storageFastMock} from './fixtures/storage-fast-mock.mjs';
import {storageHotfixMock} from './fixtures/storage-hotfix-mock.mjs';
import {noRepeatPayload} from './fixtures/no-repeat-mock.mjs';
import {mainPayload,MAIN_ID} from './fixtures/release-mock.mjs';

function scopedPayload(q,plan,scope='a'){
  const p=structuredClone(noRepeatPayload(q,plan));
  p.sessionId=`pilot-fast-${scope}`;
  p.participantId=`person-fast-${scope}`;
  p.submissionId=`sub-fast-${scope}-${q.sequence}`;
  p.trialId=`trial-fast-${scope}-${q.sequence}`;
  p.runs.direct.id=`run-fast-${scope}-${q.sequence}-direct`;
  p.runs.detour.id=`run-fast-${scope}-${q.sequence}-detour`;
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
  const plan=n.createBlockPlan(500+scope.length),history=[],payloads=[];
  for(let i=0;i<16;i++){
    const q=n.nextBlockQuestion(plan,history),p=scopedPayload(q,plan,scope);
    if(i%7===3){p.choice='skip';p.skipReason='insufficient_information';}
    m.call('trial',p);history.push(p);payloads.push(p);
  }
  return payloads;
}
function col(m,sheet,name){return m.sheets[sheet].data[0].indexOf(name);}
function sessionDataRow(m,sid){return m.sheets.Sessions.data.findIndex((r,i)=>i>0&&r?.[0]===sid);}
function removeTrialSequence(m,sid,seq){
  const h=m.sheets.Trials.data[0],s=h.indexOf('sessionId'),q=h.indexOf('trialSequence');
  m.sheets.Trials.data=[h,...m.sheets.Trials.data.slice(1).filter(r=>!(r?.[s]===sid&&Number(r?.[q])===seq))];
}

test('v11 keeps browser-compatible handshake and advertises fast storage marker',()=>{
  const m=storageFastMock(),r=m.call('ping',{experimentId:MAIN_ID,studyStatus:'released',protocolVersion:n.BLOCK_PROTOCOL});
  assert.equal(r.releaseVersion,'no-repeat-collector-v9');
  assert.equal(r.collectorVersion,'repairable-block-collector-v7');
  assert.equal(r.storageHotfixVersion,'fast-session-state-v11');
  assert.equal(r.collectionOpen,true);
});

test('normal trial path uses one explicit flush and canonical Session history instead of rescanning all responses',()=>{
  const m=storageFastMock(),plan=n.createBlockPlan(11),history=[];
  const first=scopedPayload(n.nextBlockQuestion(plan,history),plan,'perf');
  const f0=m.flushes;m.call('trial',first);assert.equal(m.flushes-f0,1);
  history.push(first);
  const second=scopedPayload(n.nextBlockQuestion(plan,history),plan,'perf');
  const f1=m.flushes;m.call('trial',second);assert.equal(m.flushes-f1,1);
  const s=m.rows('Sessions')[0];
  assert.equal(Number(s.savedTrials),2);
  const committed=JSON.parse(s.committedHistoryJson);
  assert.deepEqual(committed.map(x=>x.trialSequence),[1,2]);
  assert.equal(committed[1].submissionId,second.submissionId);
});

test('same-ID retry repairs every injected partial-write point without duplication',()=>{
  const plan=n.createBlockPlan(12),first=scopedPayload(n.nextBlockQuestion(plan,[]),plan,'repair');
  const probe=storageFastMock();probe.call('trial',first);const writeCount=probe.writes;
  assert.ok(writeCount>0);
  for(const when of ['before','after'])for(let failAt=1;failAt<=writeCount;failAt++){
    const m=storageFastMock({failAt,when});
    assert.throws(()=>m.call('trial',first),undefined,`expected injected failure at ${failAt}/${when}`);
    assert.equal(m.held,false);
    m.call('trial',first);
    assert.equal(m.rows('Trials').length,1,`Trial duplicate at ${failAt}/${when}`);
    assert.equal(m.rows('Runs').length,2,`Run duplicate at ${failAt}/${when}`);
    assert.equal(m.rows('Sessions').length,1,`Session duplicate at ${failAt}/${when}`);
    assert.equal(m.rows('Trials')[0].saveState,'complete');
    assert.equal(Number(m.rows('Sessions')[0].savedTrials),1);
    assert.equal(JSON.parse(m.rows('Sessions')[0].committedHistoryJson).length,1);
  }
});

test('exact production failure shape (history says 16, Runs 32, Trial 16 missing) is repaired by same pending submission',()=>{
  const m=storageFastMock(),all=completeSession(m,'prod-shape'),last=all.at(-1);
  assert.equal(m.rows('Trials').length,16);assert.equal(m.rows('Runs').length,32);
  removeTrialSequence(m,last.sessionId,16);
  assert.equal(m.rows('Trials').length,15);
  assert.equal(m.rows('Runs').length,32);
  assert.equal(Number(m.rows('Sessions')[0].savedTrials),16);
  assert.equal(JSON.parse(m.rows('Sessions')[0].committedHistoryJson).length,16);
  m.call('trial',last);
  assert.equal(m.rows('Trials').length,16);
  assert.equal(m.rows('Runs').length,32);
  assert.equal(Number(m.rows('Sessions')[0].savedTrials),16);
});

test('pre-v11 session migrates once from existing Trials and continues without changing question protocol',()=>{
  const old=storageHotfixMock(),plan=n.createBlockPlan(15),history=[];
  for(let i=0;i<3;i++){
    const q=n.nextBlockQuestion(plan,history),p=scopedPayload(q,plan,'migrate');
    old.call('trial',p);history.push(p);
  }
  const m=storageFastMock();
  for(const name of ['Trials','Runs','Sessions']){
    m.sheets[name].data=structuredClone(old.sheets[name].data);
    m.sheets[name].maxCols=old.sheets[name].maxCols;
  }
  assert.equal(m.sheets.Sessions.data[0].includes('committedHistoryJson'),false);
  const fourth=scopedPayload(n.nextBlockQuestion(plan,history),plan,'migrate');
  m.call('trial',fourth);
  assert.equal(m.rows('Trials').length,4);
  assert.equal(m.rows('Runs').length,8);
  assert.equal(Number(m.rows('Sessions')[0].savedTrials),4);
  assert.equal(JSON.parse(m.rows('Sessions')[0].committedHistoryJson).length,4);
});

test('profile completion validates 16 complete Trials and all 32 linked Runs outside the long write lock',()=>{
  const m=storageFastMock(),all=completeSession(m,'finish'),last=all.at(-1);
  assert.equal(m.rows('Trials').length,16);assert.equal(m.rows('Runs').length,32);
  const f0=m.flushes;m.call('profile',profilePayload(last));
  assert.ok(m.flushes-f0<=1);
  assert.equal(m.rows('Sessions')[0].status,'completed');
  assert.equal(Number(m.rows('Sessions')[0].savedTrials),16);
  assert.equal(m.call('profile',profilePayload(last)).duplicate,true);
});

test('completion refuses missing Trial or linked Run, then succeeds after repair',()=>{
  const m=storageFastMock(),all=completeSession(m,'completion-repair'),last=all.at(-1);
  removeTrialSequence(m,last.sessionId,16);
  assert.throws(()=>m.call('profile',profilePayload(last)),/아직 저장되지 않은 문항/);
  m.call('trial',last);
  const run=m.sheets.Runs.data.pop();
  assert.throws(()=>m.call('profile',profilePayload(last)),/실행 기록이 누락/);
  m.sheets.Runs.data.push(run);
  m.call('profile',profilePayload(last));
  assert.equal(m.rows('Sessions')[0].status,'completed');
});

test('lock contention is retryable and writes nothing before acquiring the lock',()=>{
  const m=storageFastMock({lockFailCount:1}),plan=n.createBlockPlan(18),p=scopedPayload(n.nextBlockQuestion(plan,[]),plan,'lock');
  assert.throws(()=>m.call('trial',p),/저장소가 사용 중/);
  assert.equal(m.rows('Trials').length,0);assert.equal(m.rows('Runs').length,0);assert.equal(m.rows('Sessions').length,0);
  m.call('trial',p);
  assert.equal(m.rows('Trials').length,1);assert.equal(m.rows('Runs').length,2);assert.equal(m.rows('Sessions').length,1);
});

test('128-session stress never overwrites another participant and keeps one Trial/two Runs per answer',()=>{
  const m=storageFastMock(),count=128;
  for(let i=0;i<count;i++){
    const plan=n.createBlockPlan(i),p=scopedPayload(n.nextBlockQuestion(plan,[]),plan,`stress-${i}`);
    m.call('trial',p);
  }
  assert.equal(m.rows('Trials').length,count);
  assert.equal(m.rows('Runs').length,count*2);
  assert.equal(m.rows('Sessions').length,count);
  assert.equal(new Set(m.rows('Trials').map(r=>r.submissionId)).size,count);
  assert.equal(new Set(m.rows('Sessions').map(r=>r.sessionId)).size,count);
  assert.equal(m.rows('Sessions').every(r=>Number(r.savedTrials)===1),true);
});

test('legacy v7 still uses the previous collector path unchanged',()=>{
  const m=storageFastMock(),plan=legacy.createBlockPlan(21),q=legacy.nextBlockQuestion(plan,[]),p=mainPayload(q,plan);
  const r=m.call('trial',p);
  assert.equal(r.releaseVersion,'isolated-main-collector-v8');
  assert.equal(m.rows('Trials').length,1);assert.equal(m.rows('Runs').length,2);
});
