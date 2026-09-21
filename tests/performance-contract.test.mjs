import test from 'node:test';
import assert from 'node:assert/strict';
import { RolloutCache, rolloutKey } from '../src/core/rollout-cache.ts';
import { checkedAssetPath, versionedAssetUrl } from '../src/runtime/bundle-loader.ts';
import { meshGeometry } from '../src/runtime/mesh-geometry.ts';

const s={id:'one',height:.05,width:.7,depth:.8,speed:.3,detour:.8,routes:{direct:[[0,0],[6,0]],detour:[[0,0],[2,1.3],[4,1.3],[6,0]]}};
const key=(v,route='direct',hashes={policy:'abc'})=>rolloutKey(hashes,{dt:.002},v,route);
const run={id:'original',completed:true,frames:[{time:0,qpos:[0,0,1]}]};
test('direct reuse ignores detour label but not the actual direct points',()=>{
  const other={...s,id:'two',detour:1.2,routes:{...s.routes,detour:[[0,0],[2,1.7],[4,1.7],[6,0]]}};
  assert.equal(key(s),key(other));assert.notEqual(key(s,'detour'),key(other,'detour'));
  assert.notEqual(key(s),key({...s,routes:{...s.routes,direct:[[0,0],[5,0]]}}));
});
test('physics, policy and controller conditions invalidate cached clips',()=>{
  for(const [k,v] of [['height',.06],['width',.8],['depth',.9],['speed',.35]]) assert.notEqual(key(s),key({...s,[k]:v}));
  assert.notEqual(key(s),key(s,'direct',{policy:'changed'}));
  assert.notEqual(key(s),rolloutKey({policy:'abc'},{dt:.004},s,'direct'));
});
test('LRU shares immutable frames, stays bounded and excludes failures',()=>{
  const c=new RolloutCache(10000,2);c.set('a',run);c.set('b',run);assert.equal(c.get('a'),run);
  c.set('c',run);assert.equal(c.get('b'),undefined);assert.equal(c.size,2);
  c.set('fail',{...run,completed:false});assert.equal(c.get('fail'),undefined);
  c.set('huge',{...run,frames:[{time:0,qpos:Array(10000).fill(0)}]});assert.equal(c.get('huge'),undefined);
  c.clear();assert.equal(c.bytes,0);assert.equal(c.size,0);
});
test('asset cache keys are versioned and path traversal is rejected',()=>{
  const base=new URL('https://example.test/repo/models/rubi-web/');
  assert.equal(versionedAssetUrl(base,'meshes/BODY.STL','abcd').searchParams.get('sha256'),'abcd');
  for(const p of ['../secret','/absolute','a//b','https://bad/a','bad.exe']) assert.throws(()=>checkedAssetPath(p));
});
test('normal reuse obeys separate corner indices even with equal array lengths',()=>{
  const model={mesh_vertadr:[0],mesh_vertnum:[3],mesh_faceadr:[0],mesh_facenum:[1],mesh_normaladr:[0],mesh_normalnum:[3],
    mesh_vert:new Float32Array([0,0,0,1,0,0,0,1,0]),mesh_face:new Int32Array([0,1,2]),
    mesh_normal:new Float32Array([1,0,0,0,1,0,0,0,1]),mesh_facenormal:new Int32Array([2,0,1])};
  const g=meshGeometry(model,0);
  assert.equal(g.userData.normalSource,'mujoco');assert.equal(g.index,null);
  assert.deepEqual(Array.from(g.attributes.normal.array),[0,0,1,1,0,0,0,1,0]);g.dispose();
  model.mesh_facenormal.set([0,1,2]);const aligned=meshGeometry(model,0);
  assert.ok(aligned.index);assert.deepEqual(Array.from(aligned.attributes.normal.array),Array.from(model.mesh_normal));aligned.dispose();
});
