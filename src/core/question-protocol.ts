// Immutable v7 sessions and new v9 sessions share UI, not question state.
import * as legacy from './height-block-study.ts';
import * as current from './height-block-study-v9.ts';
export type BlockPlan=legacy.BlockPlan|current.BlockPlan;
export type BlockAnswer=legacy.BlockAnswer;
export type BlockQuestion=legacy.BlockQuestion;
export const acknowledgeAnswer=legacy.acknowledgeAnswer;
export const questionCount=(p:BlockPlan)=>p.blocks.length*4;
export function questionProtocol(version:string){
  if(version===legacy.BLOCK_PROTOCOL)return legacy;
  if(version===current.BLOCK_PROTOCOL)return current;
  throw new Error('지원하지 않는 질문 버전입니다.');
}
export function validBlockPlan(p:unknown,heights:number[]):p is BlockPlan {
  return legacy.validBlockPlan(p,heights)||current.validBlockPlan(p,heights);
}
export function nextBlockQuestion(p:BlockPlan,a:BlockAnswer[]):BlockQuestion|null {
  if(p.version===legacy.BLOCK_RULE)return legacy.nextBlockQuestion(p as legacy.BlockPlan,a);
  if(p.version===current.BLOCK_RULE)return current.nextBlockQuestion(p as current.BlockPlan,a);
  throw new Error('질문 버전이 달라 기존 참여를 이어갈 수 없습니다.');
}
