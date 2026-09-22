import type { RouteKey } from './scenario.ts';

export const BINARY_PROTOCOL='same-policy-intro-binary-v6';
export const BINARY_LABEL_CONDITION='same-policy-intro-core-view-explicit-binary-v1';
export const INTRO_VERSION='same-policy-intro-v1';
export type BinaryAnswer=RouteKey|'skip';
export const isBinaryAnswer=(v:unknown):v is BinaryAnswer=>v==='direct'||v==='detour'||v==='skip';
export function routeChoice(scene:{height:number;detour:number},route:RouteKey,letter:'A'|'B'){
  if(!Number.isFinite(scene.height)||!Number.isFinite(scene.detour))throw new Error('경로 정보가 올바르지 않습니다.');
  const h=Math.round(scene.height*100),d=scene.detour.toFixed(1);
  return route==='direct'?{
    detail:`높이 ${h} cm인 턱을 올라갔다 내려오는 짧은 길`,
    button:`${h} cm 턱을 통과하는 길\n${letter}로 보내기`
  }:{
    detail:`턱을 피해 평평한 곳으로 ${d} m 더 돌아가는 길`,
    button:`${d} m 더 돌아가는 길\n${letter}로 보내기`
  };
}
export type IntroEpisode={id:string;title:string;startSeconds:number;mediaDurationSeconds:number;height:number;route:RouteKey;run:{completed:boolean;duration:number}};
export type IntroManifest={version:string;contentId:string;simulationOnly:boolean;nominalNavigationCommand:number;physicsDt:number;policyDt:number;fps:number;video:string;poster:string;videoSha256:string;durationSeconds:number;assetHashes:Record<string,string>;episodes:IntroEpisode[]};
export function validateIntro(value:unknown):IntroManifest{
  if(!value||typeof value!=='object')throw new Error('소개 영상 정보를 불러오지 못했습니다.');
  const m=value as IntroManifest;
  if(m.version!==INTRO_VERSION||m.simulationOnly!==true||!/^[a-f0-9]{64}$/.test(m.contentId)||!/^[a-f0-9]{64}$/.test(m.videoSha256))throw new Error('소개 영상 버전이 맞지 않습니다.');
  if(m.nominalNavigationCommand!==.5||m.physicsDt!==.002||m.policyDt!==.01)throw new Error('소개 영상의 제어 조건이 다릅니다.');
  if(m.video!=='rubi-intro.mp4'||m.poster!=='poster.jpg'||!Number.isFinite(m.durationSeconds)||m.durationSeconds<=0)throw new Error('소개 영상 파일이 올바르지 않습니다.');
  if(!m.assetHashes||!['encoder.onnx','policy.onnx','rubi.xml'].every(k=>/^[a-f0-9]{64}$/.test(m.assetHashes[k]??'')))throw new Error('소개 영상의 모델 정보가 없습니다.');
  if(!Array.isArray(m.episodes)||m.episodes.length!==6)throw new Error('소개 영상의 예시 구성이 다릅니다.');
  const expected=[['flat',0,'direct'],['step-05',.05,'direct'],['step-07',.07,'direct'],['step-09',.09,'direct'],['step-11',.11,'direct'],['bypass',.07,'detour']];
  m.episodes.forEach((e,i)=>{
    if(e.id!==expected[i][0]||e.height!==expected[i][1]||e.route!==expected[i][2]||e.run?.completed!==true||typeof e.title!=='string'||!Number.isFinite(e.startSeconds)||e.startSeconds<0||!Number.isFinite(e.mediaDurationSeconds)||e.mediaDurationSeconds<=0)throw new Error('검증되지 않은 소개 예시가 있습니다.');
  });
  return m;
}
export function assertIntroAssets(m:IntroManifest,hashes:Record<string,string>):void{
  const keys=Object.keys(hashes);
  if(keys.length!==Object.keys(m.assetHashes).length||keys.some(k=>hashes[k]!==m.assetHashes[k]))throw new Error('소개 영상과 현재 로봇 모델·제어기가 다릅니다. 연구자에게 알려 주세요.');
}
// The current collector already persists tutorialVersion. Include the exact
// content ID there, not just in an extra JSON key that the collector discards.
export const introRecordVersion=(m:IntroManifest)=>`${m.version}:${m.contentId}`;
