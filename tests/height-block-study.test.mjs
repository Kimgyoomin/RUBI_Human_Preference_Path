import test from 'node:test';
import assert from 'node:assert/strict';
import {createBlockPlan,validBlockPlan,nextBlockQuestion,questionCount,acknowledgeAnswer,DETOURS_MM} from '../src/core/height-block-study.ts';
function add(p,a,choice){const q=nextBlockQuestion(p,a);a.push({submissionId:`s-${a.length}`,trialSequence:q.sequence,scenario:{height:q.heightCm/100,detour:q.detourMm/1000},choice});return q;}
test('four consecutive questions per height, balanced starts and A/B; seed is replayable',()=>{
  for(let seed=0;seed<100;seed++){
    const p=createBlockPlan(seed);assert.ok(validBlockPlan(p));assert.equal(questionCount(p),16);
    assert.deepEqual([...p.blocks.map(b=>b.heightCm)].sort((a,b)=>a-b),[5,7,9,11]);
    assert.equal(p.blocks.filter(b=>b.first==='low').length,2);
    for(const b of p.blocks)assert.equal(b.aRoutes.filter(a=>a==='direct').length,2);
    const a=[];for(let i=0;i<16;i++){const q=add(p,a,i%3===0?'skip':i%2===0?'direct':'detour');assert.equal(q.blockIndex,Math.floor(i/4)+1);assert.equal(q.trialInBlock,i%4+1);assert.equal(q.heightCm,p.blocks[Math.floor(i/4)].heightCm);assert.ok(DETOURS_MM.includes(q.detourMm));}
    assert.equal(nextBlockQuestion(p,a),null);assert.deepEqual(createBlockPlan(seed),p);
  }
});
test('opposite endpoint answers choose middle; one direct answer never ends a block',()=>{
  const p=createBlockPlan(3,[9]),a=[];
  const q=add(p,a,'direct');assert.equal(nextBlockQuestion(p,a).blockIndex,1);
  a.length=0;for(let n=0;n<2;n++){const q=nextBlockQuestion(p,a);add(p,a,q.detourMm<1100?'detour':'direct');}
  assert.equal(nextBlockQuestion(p,a).detourMm,1000);add(p,a,'detour');assert.ok([1200,1400].includes(nextBlockQuestion(p,a).detourMm));
});
test('all-direct/all-detour do not invent costs; inconsistent and skipped answers are retained',()=>{
  for(const choice of ['direct','detour']){const p=createBlockPlan(1,[9]),a=[];add(p,a,choice);add(p,a,choice);const q=nextBlockQuestion(p,a);assert.equal(q.detourMm,choice==='direct'?400:1600);assert.equal(q.context.state,`all_${choice}`);}
  const p=createBlockPlan(1,[9]),a=[];for(let i=0;i<2;i++){const q=nextBlockQuestion(p,a);add(p,a,q.detourMm===400?'direct':'detour');}assert.equal(nextBlockQuestion(p,a).reason,'conflict_recheck');assert.equal(a.length,2);
  const s=[];add(p,s,'skip');add(p,s,'direct');assert.equal(nextBlockQuestion(p,s).reason,'skipped_endpoint_recheck');
});
test('all 81 answer sequences for a height stay valid, terminate at four, resume identically',()=>{
  for(let code=0;code<81;code++){const p=createBlockPlan(code,[9]),a=[];let x=code;for(let i=0;i<4;i++){const q=nextBlockQuestion(p,a);assert.deepEqual(nextBlockQuestion(JSON.parse(JSON.stringify(p)),JSON.parse(JSON.stringify(a))),q);add(p,a,['direct','detour','skip'][x%3]);x=Math.floor(x/3);}assert.equal(nextBlockQuestion(p,a),null);}
});
test('invalid history and local persistence failures never silently advance',()=>{
  const p=createBlockPlan(2),a=[];add(p,a,'direct');a[0].scenario.detour=.9;assert.throws(()=>nextBlockQuestion(p,a));
  const s={index:0,responses:[],pending:{submissionId:'x',choice:'direct'}};
  assert.throws(()=>acknowledgeAnswer(s,()=>{throw new Error('quota');}));assert.equal(s.index,0);assert.ok(s.pending);
  let saved;const n=acknowledgeAnswer(s,x=>{saved=x;});assert.equal(n.index,1);assert.equal(saved.responses.length,1);
  const repeat=acknowledgeAnswer({...n,pending:s.pending},()=>{});assert.equal(repeat.index,1);assert.equal(repeat.responses.length,1);
});
