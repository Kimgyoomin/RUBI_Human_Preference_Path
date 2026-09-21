import test from 'node:test';
import assert from 'node:assert/strict';
import {makeScenario,length,turnAngles,platformClearance,sampleRoute,Follower,ROUTE_GEOMETRY_VERSION} from '../src/core/scenario.ts';
const close=(a,b,tol=1e-10)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);

test('smooth routes match requested excess polyline length over the full slider range',()=>{
  for(let i=0;i<=200;i++) {
    const extra=.4+i/100,s=makeScenario(.05,extra);
    close(length(s.routes.direct),6);close(length(s.routes.detour),6+extra);
    close(s.geometry.lengthErrorM,0);assert.ok(s.geometry.minCenterlineClearanceM>=.4);
  }
});
test('both endpoints have horizontal analytic tangents; sampled curve is symmetric and dense',()=>{
  for(const extra of [.4,.8,1.2,1.6,2.4]) {
    const s=makeScenario(.05,extra),p=s.routes.detour,g=s.geometry;
    assert.deepEqual(p[0],[0,0]);assert.deepEqual(p.at(-1),[6,0]);assert.deepEqual(g.analyticEndpointHeadingRad,[0,0]);
    assert.ok(Math.abs(g.metrics.detour.startHeadingRad)<.01);assert.ok(Math.abs(g.metrics.detour.endHeadingRad)<.01);
    for(let i=0;i<p.length;i++) {
      close(p[i][1],p[p.length-1-i][1]);assert.ok(p[i].every(Number.isFinite));
      if(i){assert.ok(p[i][0]>p[i-1][0]);assert.ok(Math.hypot(p[i][0]-p[i-1][0],p[i][1]-p[i-1][1])<.05);}
    }
    assert.ok(Math.max(...turnAngles(p))<.02);
    close(g.metrics.detour.maxCurvaturePerM,g.analyticMaxCurvaturePerM,2e-4);
    assert.ok(g.metrics.detour.integratedAbsCurvatureRad<=g.analyticIntegratedAbsCurvatureRad+1e-8);
  }
});
test('clearance checks complete segments, including obstacle intersection and corners',()=>{
  assert.equal(platformClearance([[0,0],[6,0]]),0);
  assert.equal(platformClearance([[2,1],[4,-1]]),0);
  close(platformClearance([[0,1],[6,1]]),.65);
  close(platformClearance([[0,0],[1,0]]),1.6);
  assert.throws(()=>platformClearance([[0,0]]));assert.throws(()=>platformClearance([[0,0],[6,0]],NaN));
});
test('path geometry is independent of step height and speed',()=>{
  const baseline=makeScenario(0,.8,.1).routes;
  for(const h of [0,.04,.05,.08,.12])for(const speed of [.1,.3,.5])assert.deepEqual(makeScenario(h,.8,speed).routes,baseline);
});
test('rendering marker count is bounded by arc length, not the 481 control points',()=>{
  for(const extra of [.4,.8,1.6,2.4]) {
    const p=makeScenario(.05,extra).routes.detour,markers=sampleRoute(p);
    assert.deepEqual(markers[0],p[0]);assert.deepEqual(markers.at(-1),p.at(-1));
    assert.ok(markers.length<=72);assert.ok(markers.length<=Math.ceil(length(p)/.12)+1);
    for(let i=1;i<markers.length;i++)assert.ok(Math.hypot(markers[i][0]-markers[i-1][0],markers[i][1]-markers[i-1][1])<=.120000001);
  }
  assert.throws(()=>sampleRoute([[0,0],[6,0]],0));assert.throws(()=>sampleRoute([[0,0],[6,0]],1e-10));
});
test('all out-of-range or non-finite scene inputs are rejected',()=>{
  for(const x of [NaN,Infinity,-1]) {
    assert.throws(()=>makeScenario(x,.8,.3));assert.throws(()=>makeScenario(.05,x,.3));assert.throws(()=>makeScenario(.05,.8,x));
  }
  for(const [h,d,v] of [[.13,.8,.3],[0,.39,.3],[0,2.41,.3],[0,.8,.09],[0,.8,.51]])assert.throws(()=>makeScenario(h,d,v));
});
test('new geometry is identifiable in serialized survey/rollout scenarios',()=>{
  const s=makeScenario(),copy=JSON.parse(JSON.stringify(s));
  assert.ok(s.id.includes(ROUTE_GEOMETRY_VERSION));assert.equal(copy.geometry.version,ROUTE_GEOMETRY_VERSION);
  assert.equal(copy.geometry.metrics.direct.maxCurvaturePerM,0);
  assert.equal(copy.geometry.metrics.direct.plannedLengthM,6);
  assert.ok(copy.geometry.analyticIntegratedAbsCurvatureRad>0);
});
test('kinematic follower sanity: smooth detours arrive without sharp start commands',()=>{
  // This is a geometry/controller test, NOT a learned RUBI locomotion result.
  for(const extra of [.4,.8,1.6,2.4])for(const speed of [.1,.3,.5]) {
    const f=new Follower(makeScenario(.05,extra,speed).routes.detour,speed),p=[0,0];let yaw=0,done=false,maxError=0;
    assert.ok(Math.abs(f.command(p,yaw).velocity[2])<.7);
    for(let i=0;i<12000;i++) {
      const c=f.command(p,yaw);maxError=Math.max(maxError,c.error);
      if(c.done){done=true;break;}
      yaw+=c.velocity[2]*.02;p[0]+=c.velocity[0]*Math.cos(yaw)*.02;p[1]+=c.velocity[0]*Math.sin(yaw)*.02;
    }
    assert.ok(done,`${extra}, ${speed}`);assert.ok(maxError<.2);assert.ok(Math.hypot(p[0]-6,p[1])<.14);
  }
});
