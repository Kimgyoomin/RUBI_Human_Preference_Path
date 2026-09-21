import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {appsScriptEndpoint} from '../src/runtime/apps-script.ts';

test('Apps Script collector only accepts deployed https /exec endpoints',()=>{
  assert.equal(appsScriptEndpoint('https://script.google.com/macros/s/ABC123/exec'),'https://script.google.com/macros/s/ABC123/exec');
  for(const bad of ['', 'http://script.google.com/macros/s/A/exec','https://example.com/macros/s/A/exec','https://script.google.com/macros/s/A/dev']) assert.throws(()=>appsScriptEndpoint(bad));
});

test('collector code pins the intended private Sheet and protects writes',()=>{
  const code=fs.readFileSync(new URL('../apps-script/Code.gs',import.meta.url),'utf8');
  assert.match(code,/1u7mXgUFagYepp1oOxVohs5x7i7bCfnBVZbQKKcwOYQA/);
  assert.match(code,/LockService\.getScriptLock\(\)/);
  assert.match(code,/submissionId/);
  assert.match(code,/postMessage/);
  assert.doesNotMatch(code,/PRIVATE_KEY|client_secret|BEGIN PRIVATE KEY/);
});
