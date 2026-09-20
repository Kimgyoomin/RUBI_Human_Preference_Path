import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchHostedFiles } from '../src/runtime/hosted-bundle.ts';

const base = new URL('https://example.test/RUBI_Human_Preference_Path/rubi/');
const files = ['rubi.xml', 'encoder.onnx', 'policy.onnx', 'meshes/BODY.STL'];
function manifest(extra={}) { return {schemaVersion:1,profile:'gazebo-terrain-330-32-65-6',files:files.map(path=>({path})),...extra}; }
function mock(t, data, absent=[]) {
  const original=globalThis.fetch;
  globalThis.fetch=async url=>{
    const name=new URL(url).pathname.replace(base.pathname,'');
    if(name==='bundle.json') return Response.json(data);
    if(absent.includes(name)) return new Response('',{status:404});
    return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'application/octet-stream'}});
  };
  t.after(()=>{globalThis.fetch=original;});
}
test('hosted bundle loads named assets relative to the repository base',async t=>{
  mock(t,manifest());
  const actual=await fetchHostedFiles(base);
  assert.deepEqual(actual.map(f=>f.name),['rubi.xml','encoder.onnx','policy.onnx','BODY.STL']);
});
test('all missing files are reported together',async t=>{
  mock(t,manifest(),['encoder.onnx','meshes/BODY.STL']);
  await assert.rejects(fetchHostedFiles(base),e=>e.message.includes('encoder.onnx')&&e.message.includes('meshes/BODY.STL'));
});
test('a policy hash mismatch blocks loading',async t=>{
  const data=manifest();data.files[1].sha256='0'.repeat(64);mock(t,data);
  await assert.rejects(fetchHostedFiles(base),/SHA256/);
});
test('manifest path traversal is rejected',async t=>{
  const data=manifest();data.files.push({path:'../secret.xml'});mock(t,data);
  await assert.rejects(fetchHostedFiles(base),/허용되지 않은/);
});
