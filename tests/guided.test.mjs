import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pilotOrder,validProfile,canChoose,choiceDescription} from '../src/core/guided-study.ts';
import {activatePlatform,heightCentimetres} from '../src/runtime/resident-platforms.ts';

test('all height conditions appear once per interleaved fixed-pilot round',()=>{
  const scenes=[.05,.07,.09,.11].flatMap(height=>[.4,.8,1.2,1.6].map(detour=>({height,detour,speed:.5})));
  for(let n=0;n<20;n++){
    const order=pilotOrder(scenes);assert.equal(new Set(order).size,16);
    for(let i=0;i<16;i+=4)assert.equal(new Set(order.slice(i,i+4).map(k=>scenes[k].height)).size,4);
  }
});
test('non-robotics participants may independently know RUBI',()=>{
  assert.ok(validProfile({roboticsRelatedExperience:'no',knewRubiBeforeStudy:'yes',rubiExposureBeforeStudy:'in_person',answeredAtUtc:'2026-09-22T00:00:00Z'}));
  assert.ok(!validProfile({roboticsRelatedExperience:'yes'}));
});
test('choice requires completed and observed A and B, not just generation',()=>{
  assert.ok(!canChoose(new Set(['direct']),{direct:true,detour:true}));
  assert.ok(!canChoose(new Set(['direct','detour']),{direct:true,detour:false}));
  assert.ok(canChoose(new Set(['direct','detour']),{direct:true,detour:true}));
  assert.equal(choiceDescription({height:.07,detour:.6,speed:.5},'detour'),'평지로 0.6 m 더 이동');
});
test('resident platform mask switching leaves exactly one platform active and unions intact',()=>{
  const m={ngeom:13,geom_bodyid:new Int32Array(13),geom_contype:new Int32Array(13).fill(1),geom_conaffinity:new Int32Array(13).fill(15),body_contype:new Int32Array(1),body_conaffinity:new Int32Array(1)};
  const ids=Array.from({length:12},(_,i)=>i+1);
  for(const h of [0,.05,.07,.09,.11,.05,0]){
    activatePlatform(m,ids,h);
    assert.equal(ids.filter(i=>m.geom_contype[i]!==0).length,h===0?0:1);
    for(const i of ids)assert.equal(m.geom_conaffinity[i],i===Math.round(h*100)?15:0);
    assert.equal(m.geom_contype[0],1);assert.equal(m.body_contype[0],1);assert.equal(m.body_conaffinity[0],15);
  }
  assert.throws(()=>heightCentimetres(.055));assert.throws(()=>heightCentimetres(NaN));
});
test('observation renderer does not construct text labels',()=>{
  const viewer=fs.readFileSync(new URL('../src/runtime/viewer.ts',import.meta.url),'utf8');
  assert.doesNotMatch(viewer,/this\.label\(|new T\.CanvasTexture/);
  assert.match(viewer,/start-green-disc/);assert.match(viewer,/goal-red-target/);
});
