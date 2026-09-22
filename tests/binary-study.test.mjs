import test from 'node:test';
import assert from 'node:assert/strict';
import {BINARY_PROTOCOL,INTRO_VERSION,routeChoice,isBinaryAnswer,validateIntro,assertIntroAssets,introRecordVersion} from '../src/core/binary-study.ts';
const hash='a'.repeat(64);
function manifest(){return {version:INTRO_VERSION,contentId:hash,videoSha256:hash,simulationOnly:true,nominalNavigationCommand:.5,physicsDt:.002,policyDt:.01,video:'rubi-intro.mp4',poster:'poster.jpg',durationSeconds:44,assetHashes:{'encoder.onnx':hash,'policy.onnx':hash,'rubi.xml':hash},episodes:[['flat',0,'direct'],['step-05',.05,'direct'],['step-07',.07,'direct'],['step-09',.09,'direct'],['step-11',.11,'direct'],['bypass',.07,'detour']].map(([id,height,route],i)=>({id,height,route,title:id,startSeconds:i*7,mediaDurationSeconds:7,run:{completed:true,duration:7}}))};}
test('two informed choices follow route identity even when A and B are reversed',()=>{
  const s={height:.09,detour:1.2};
  assert.equal(routeChoice(s,'direct','B').button,'9 cm 턱을 통과하는 길\nB로 보내기');
  assert.equal(routeChoice(s,'detour','A').button,'1.2 m 더 돌아가는 길\nA로 보내기');
  assert.match(routeChoice(s,'direct','A').detail,/올라갔다 내려오는/);
  assert.match(routeChoice(s,'detour','B').detail,/더/);
});
test('new binary protocol excludes tie while keeping explicit non-preference skip',()=>{
  for(const c of ['direct','detour','skip'])assert.equal(isBinaryAnswer(c),true);
  for(const c of ['tie','unsure','A',null])assert.equal(isBinaryAnswer(c),false);
  assert.notEqual(BINARY_PROTOCOL,'guided-self-paced-v5');
});
test('introduction identifies all six successfully simulated episodes, not hardware capability',()=>{
  assert.equal(validateIntro(manifest()).simulationOnly,true);
  const m=manifest();m.episodes[3].run.completed=false;assert.throws(()=>validateIntro(m));
  assert.throws(()=>validateIntro({...manifest(),simulationOnly:false}));
  assert.throws(()=>validateIntro({...manifest(),nominalNavigationCommand:.3}));
  assert.throws(()=>validateIntro({...manifest(),video:'../other.mp4'}));
});
test('runtime policy/model hash mismatch blocks the introduction contract',()=>{
  const m=validateIntro(manifest());assert.doesNotThrow(()=>assertIntroAssets(m,m.assetHashes));
  assert.throws(()=>assertIntroAssets(m,{...m.assetHashes,'policy.onnx':'b'.repeat(64)}));
  assert.throws(()=>assertIntroAssets(m,{'policy.onnx':hash}));
});
test('exact introduction content ID is included in an existing collector-mapped column',()=>{
  assert.equal(introRecordVersion(manifest()),INTRO_VERSION+':'+hash);
});
