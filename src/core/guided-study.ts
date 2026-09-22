import { shuffledIndices } from './study.ts';
import type { RouteKey } from './scenario.ts';
export const GUIDED_PROTOCOL='resident-guided-v4';
export const LABEL_CONDITION='rear-oblique-no-labels-then-numeric-v1';
export type PilotScene={height:number;detour:number;speed:number};
export type ProfileAnswers={roboticsRelatedExperience:string;knewRubiBeforeStudy:string;rubiExposureBeforeStudy:string;answeredAtUtc:string};
export const PROFILE_OPTIONS={
  roboticsRelatedExperience:['yes','no','prefer_not_to_say'],
  knewRubiBeforeStudy:['yes','no','unsure','prefer_not_to_say'],
  rubiExposureBeforeStudy:['none','video_only','in_person','both','unsure','prefer_not_to_say'],
};
export function validProfile(value:unknown):value is ProfileAnswers {
  if(!value||typeof value!=='object')return false;
  const p=value as Record<string,unknown>;
  return Object.entries(PROFILE_OPTIONS).every(([k,allowed])=>typeof p[k]==='string'&&allowed.includes(p[k] as string))&&typeof p.answeredAtUtc==='string';
}
/** Balanced interleaved fixed pilot, NOT an adaptive estimator. */
export function pilotOrder(scenes:PilotScene[]):number[]{
  const heights=[...new Set(scenes.map(s=>s.height))];
  const pools=heights.map(h=>scenes.map((s,i)=>s.height===h?i:-1).filter(i=>i>=0)).map(p=>shuffledIndices(p.length).map(i=>p[i]));
  const order:number[]=[];
  while(pools.some(p=>p.length))for(const i of shuffledIndices(pools.length)){
    const next=pools[i].pop();if(next!==undefined)order.push(next);
  }
  return order;
}
export function canChoose(seen:ReadonlySet<RouteKey>,completed:Partial<Record<RouteKey,boolean>>):boolean {
  return seen.has('direct')&&seen.has('detour')&&completed.direct===true&&completed.detour===true;
}
export function choiceDescription(scene:PilotScene,key:RouteKey):string {
  return key==='direct'?`높이 ${Math.round(scene.height*100)} cm 플랫폼 통과`:`평지로 ${scene.detour.toFixed(1)} m 더 이동`;
}
