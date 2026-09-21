import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { equalityState, setEqualityActive } from '../src/runtime/equality-state.ts';

const original=new URL('../public/models/rubi/',import.meta.url);
const web=new URL('../public/models/rubi-web/',import.meta.url);
test('all distributed assets match their pinned hashes and fit the STL decoder',async()=>{
  const manifest=JSON.parse(await readFile(new URL('bundle.json',web),'utf8'));
  assert.equal(manifest.visualVariant,'qem-web-v1');
  const sourceManifest=await readFile(new URL('bundle.json',original));
  assert.equal(manifest.sourceBundleSha256,createHash('sha256').update(sourceManifest).digest('hex'));
  let meshes=0,total=0;
  for(const file of manifest.files) {
    const data=await readFile(new URL(file.path,web));
    assert.equal(createHash('sha256').update(data).digest('hex'),file.sha256,file.path);
    if(file.path.endsWith('.STL')) {
      const n=data.readUInt32LE(80);assert.ok(n>0&&n<=180000,file.path);
      assert.equal(data.length,84+50*n,file.path);meshes++;total+=data.length;
    }
  }
  assert.equal(meshes,9);assert.ok(total<12*1024*1024);
});
test('XML, policy weights and foot contact surfaces are exactly unchanged',async()=>{
  for(const path of ['rubi.xml','encoder.onnx','policy.onnx','meshes/L_TIP.STL','meshes/R_TIP.STL']) {
    assert.deepEqual(await readFile(new URL(path,web)),await readFile(new URL(path,original)),path);
  }
});
test('support release changes only its equality flag and frees the out buffer',()=>{
  let values=[1,0,1],freed=0;
  const mj={mjtState:{mjSTATE_EQ_ACTIVE:{value:256}},mj_stateSize:()=>3,
    DoubleBuffer:class{constructor(a){this.a=Float64Array.from(a);}getView(){return this.a;}delete(){freed++;}},
    mj_getState:(_m,_d,b,spec)=>{assert.equal(spec,256);b.a.set(values);},
    mj_setState:(_m,_d,a,spec)=>{assert.equal(spec,256);values=Array.from(a);}};
  setEqualityActive(mj,{}, {},0,false);assert.deepEqual(values,[0,0,1]);assert.equal(freed,1);
  assert.deepEqual(equalityState(mj,{},{}),[0,0,1]);assert.equal(freed,2);
  assert.throws(()=>setEqualityActive(mj,{}, {},4,false),/index/);assert.equal(freed,3);
});
