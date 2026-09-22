import test from 'node:test';
import assert from 'node:assert/strict';
import {createBlockPlan,nextBlockQuestion,BLOCK_PROTOCOL,BLOCK_RULE,CANDIDATE_SET,COLLECTOR_VERSION} from '../src/core/height-block-study.ts';
import {mockCollector} from './fixtures/collector-mock.mjs';
function payload(q,plan){return {schemaVersion:1,consent:true,experimentId:'rubi-hpp-block-pilot-v7',studyStatus:'draft',protocolVersion:BLOCK_PROTOCOL,participantId:'test-person',sessionId:'test-session',submissionId:`test-sub-${q.sequence}`,trialId:`test-trial-${q.sequence}`,trialSequence:q.sequence,
 scenario:{height:q.heightCm/100,detour:q.detourMm/1000,speed:.5},choice:q.detourMm<1100?'detour':'direct',
 presentation:{a:q.aRoute,b:q.aRoute==='direct'?'detour':'direct'},runs:Object.fromEntries(['direct','detour'].map(route=>[route,{id:`run-${q.sequence}-${route}`,route,scenarioId:`scenario-${q.heightCm}-${q.detourMm}`,completed:true,duration:8,plannedLength:route==='direct'?6:6+q.detourMm/1000}])),
 preProfile:{roboticsRelatedExperience:'no',knewRubiBeforeStudy:'yes',rubiExposureBeforeStudy:'video_only',answeredAtUtc:'2026-09-22T00:00:00Z'},profileAnsweredAtUtc:'2026-09-22T00:00:00Z',sessionStartedAtUtc:'2026-09-22T00:00:00Z',createdAt:'2026-09-22T00:01:00Z',
 blockIndex:q.blockIndex,trialInBlock:q.trialInBlock,blockOrder:plan.blocks.map(b=>b.heightCm),endpointOrder:q.endpointOrder,queryContext:q.context,questionPlan:plan,expectedTrials:plan.blocks.length*4,adaptiveVersion:BLOCK_RULE,candidateSetId:CANDIDATE_SET,queryReason:q.reason};}
const plan=createBlockPlan(3),first=payload(nextBlockQuestion(plan,[]),plan);
function verify(m){assert.equal(m.rows('Trials').length,1);assert.equal(m.rows('Runs').length,2);const s=m.rows('Sessions');assert.equal(s.length,1);assert.equal(s[0].status,'started');assert.equal(s[0].profileCompleted,true);assert.equal(s[0].roboticsRelatedExperience,'no');assert.equal(s[0].savedTrials,1);assert.equal(m.rows('Trials')[0].saveState,'complete');assert.equal(m.held,false);}
test('first answer stores the pre-profile without completing the session; duplicate is repaired/idempotent',()=>{const m=mockCollector({checkboxDefaults:true});const r=m.call('trial',first);assert.equal(r.collectorVersion,COLLECTOR_VERSION);verify(m);assert.equal(m.sheets.Sessions.data[1][0],'test-session');assert.ok(m.call('trial',first).duplicate);verify(m);});
test('failures before AND after every write/flush repair on same-ID retry without duplication',()=>{
 const probe=mockCollector();probe.call('trial',first);const n=probe.writes;
 for(const when of ['before','after'])for(let failAt=1;failAt<=n;failAt++){
  const m=mockCollector({failAt,when});assert.throws(()=>m.call('trial',first));assert.equal(m.held,false);m.call('trial',first);verify(m);
 }
});
test('old collector partial save (Trials exists, no Runs/Session) is repaired, not short-circuited',()=>{
 const good=mockCollector();good.call('trial',first);const broken=mockCollector();broken.sheets.Trials.data=structuredClone(good.sheets.Trials.data);broken.sheets.Trials.maxCols=good.sheets.Trials.maxCols;
 assert.ok(broken.call('trial',first).duplicate);verify(broken);
});
test('same-ID edits, new IDs for same sequence, foreign identity, and invalid pre-profile are rejected',()=>{
 const m=mockCollector();m.call('trial',first);
 assert.throws(()=>m.call('trial',{...first,choice:first.choice==='direct'?'detour':'direct'}));
 assert.throws(()=>m.call('trial',{...first,submissionId:'new-id'}));
 assert.throws(()=>m.call('trial',{...first,participantId:'other',submissionId:'other-id'}));
 assert.throws(()=>mockCollector().call('trial',{...first,preProfile:{...first.preProfile,roboticsRelatedExperience:'invalid'}}));verify(m);
});
test('completion requires all committed responses and run links; replays do not reopen session',()=>{
 const m=mockCollector(),answers=[];
 const finish={...first.preProfile,protocolVersion:BLOCK_PROTOCOL,experimentId:first.experimentId,studyStatus:'draft',sessionId:first.sessionId,participantId:first.participantId,expectedTrials:16,consent:true};
 m.call('trial',first);assert.throws(()=>m.call('profile',finish));
 for(let i=0;i<16;i++){const p=payload(nextBlockQuestion(plan,answers),plan);m.call('trial',p);answers.push(p);}
 assert.equal(m.rows('Trials').length,16);assert.equal(m.rows('Runs').length,32);m.call('profile',finish);assert.equal(m.rows('Sessions')[0].status,'completed');assert.ok(m.call('profile',finish).duplicate);m.call('trial',first);assert.equal(m.rows('Sessions')[0].status,'completed');
});
test('user text never becomes a spreadsheet formula',()=>{const m=mockCollector();m.call('trial',{...first,appCommit:'=IMPORTXML("x")'});assert.equal(m.rows('Trials')[0].appCommit.charAt(0),"'");});
