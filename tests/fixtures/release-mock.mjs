import {buildReleaseCollector} from '../../tools/build-release-collector.mjs';
import {mockCollector} from './collector-mock.mjs';
import {BLOCK_PROTOCOL,BLOCK_RULE,CANDIDATE_SET,BLOCK_LABEL_CONDITION} from '../../src/core/height-block-study.ts';
export const MAIN_ID='rubi-hpp-main-v1';
export const MAIN_SHEET='1Az6wHrRmSTjS6PeUjm2dzwI406Hnd0fyYj_JzkYdg-4';
export const source=buildReleaseCollector();
export function releaseMock(options={}){
  return mockCollector({source,handler:'releaseRequest_',targetId:MAIN_SHEET,properties:{RUBI_MAIN_COLLECTION_OPEN:'true'},...options});
}
export function mainPayload(q,plan){
  return {schemaVersion:1,consent:true,consentVersion:'consent-v1',isPractice:false,experimentId:MAIN_ID,studyStatus:'released',protocolVersion:BLOCK_PROTOCOL,
    participantId:'release-test-person',sessionId:'release-test-session',submissionId:`release-sub-${q.sequence}`,trialId:`release-trial-${q.sequence}`,trialSequence:q.sequence,
    scenario:{height:q.heightCm/100,detour:q.detourMm/1000,speed:.5},choice:q.detourMm<1100?'detour':'direct',skipReason:'',
    presentation:{a:q.aRoute,b:q.aRoute==='direct'?'detour':'direct'},
    runs:Object.fromEntries(['direct','detour'].map(route=>[route,{id:`release-run-${q.sequence}-${route}`,route,scenarioId:`scene-${q.heightCm}-${q.detourMm}`,completed:true,duration:8,plannedLength:route==='direct'?6:6+q.detourMm/1000}])),
    preProfile:{roboticsRelatedExperience:'no',knewRubiBeforeStudy:'no',rubiExposureBeforeStudy:'none',answeredAtUtc:'2026-09-23T00:00:00Z'},profileAnsweredAtUtc:'2026-09-23T00:00:00Z',
    sessionStartedAtUtc:'2026-09-23T00:00:00Z',createdAt:'2026-09-23T00:01:00Z',blockIndex:q.blockIndex,trialInBlock:q.trialInBlock,blockOrder:plan.blocks.map(b=>b.heightCm),
    endpointOrder:q.endpointOrder,queryContext:q.context,questionPlan:plan,expectedTrials:16,adaptiveVersion:BLOCK_RULE,candidateSetId:CANDIDATE_SET,queryReason:q.reason,
    labelConditionVersion:BLOCK_LABEL_CONDITION,tutorialVersion:'same-policy-intro-v1:'+ 'a'.repeat(64),
    hashes:{'encoder.onnx':'8d04fa39832111a7c52dc012cc919afb387e17301799a863830c4fa83ab9d1ed','policy.onnx':'bb7c45952e7471975c024127f8c8814f997ef1194e56f6c271f3834343939732'}};
}
