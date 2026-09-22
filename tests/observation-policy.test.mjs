import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { viewingCheckpoint, canFinishViewing, viewedFraction, preserveAndRestart, UX_PROTOCOL } from '../src/core/observation-policy.ts';

test('A and B use the same platform-exit viewing checkpoint, not an arbitrary seconds threshold',()=>{
  assert.ok(Math.abs(viewingCheckpoint({depth:.8})-3.8)<1e-9);
  assert.equal(canFinishViewing({depth:.8},3.7,4,4000,34),false);
  assert.equal(canFinishViewing({depth:.8},3.81,4,4000,34),true);
});
test('a slow or interrupted first view cannot qualify for early confirmation',()=>{
  assert.equal(canFinishViewing({depth:.8},4,4,5000,34),false);
  assert.equal(canFinishViewing({depth:.8},4,4,4000,401),false);
  assert.equal(canFinishViewing({depth:.8},4,NaN,4000,34),false);
  assert.equal(canFinishViewing({depth:.8},4,0,0,0),false);
});
test('unseen simulation tail is never reported as full preview coverage',()=>{
  assert.equal(viewedFraction(4,8),.5);
  assert.equal(viewedFraction(8,8),1);
  assert.equal(viewedFraction(NaN,8),0);
  assert.equal(viewedFraction(4,0),0);
});
test('restart archives answers and retains participant identity while replacing the session',()=>{
  const previous={id:'old',participantId:'person',responses:[{submissionId:'saved'}],complete:true};
  const next={id:'new',participantId:'person',responses:[],complete:false};
  const values=new Map([['assets','keep'],['active',JSON.stringify(previous)]]);
  const store={setItem:(key,value)=>values.set(key,value)};
  preserveAndRestart(store,'active',previous,next);
  assert.deepEqual(JSON.parse(values.get('active:archive:old')),previous);
  assert.deepEqual(JSON.parse(values.get('active')),next);
  assert.equal(values.get('assets'),'keep');
});
test('restart cannot discard a pending answer or reuse another participant identity',()=>{
  let writes=0;const storage={setItem:()=>writes++};
  assert.throws(()=>preserveAndRestart(storage,'active',{id:'old',participantId:'p',pending:{submissionId:'retry'}},{id:'new',participantId:'p'}));
  assert.throws(()=>preserveAndRestart(storage,'active',{id:'old',participantId:'p'},{id:'new',participantId:'q'}));
  assert.throws(()=>preserveAndRestart(storage,'active',{id:'old',participantId:'p'},{id:'old',participantId:'p'}));
  assert.equal(writes,0);
});
test('archive failure does not replace the active session',()=>{
  const calls=[];const store={setItem:(k,v)=>{calls.push(k);throw new Error('quota');}};
  assert.throws(()=>preserveAndRestart(store,'active',{id:'old',participantId:'p'},{id:'new',participantId:'p'}));
  assert.deepEqual(calls,['active:archive:old']);
});
test('v5 copy is Korean, reset is targeted and replay choices await playback cleanup',()=>{
  const code=fs.readFileSync(new URL('../src/participant.ts',import.meta.url),'utf8');
  assert.equal(UX_PROTOCOL,'guided-self-paced-v5');
  assert.doesNotMatch(code,/[\u3040-\u30ff]/);
  assert.doesNotMatch(code,/localStorage\.clear\(/);
  assert.doesNotMatch(code,/previewCoverage:\s*\{direct:1,detour:1\}/);
  assert.match(code,/abort\?\.abort\(\);await observationTask/);
  assert.match(code,/choiceDuringReplay/);
  assert.match(code,/이 정도면 알겠어요/);
});
