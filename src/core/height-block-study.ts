/** Question scheduling only. No cost estimate, posterior or confidence interval. */
export const BLOCK_PROTOCOL='height-blocks-binary-v7';
export const BLOCK_LABEL_CONDITION='same-policy-intro-blocks-explicit-binary-v2';
export const BLOCK_RULE='endpoint-midpoint-recheck-v1';
export const CANDIDATE_SET='detour-400-1600-step200-v1';
export const COLLECTOR_VERSION='repairable-block-collector-v7';
export const DETOURS_MM=[400,600,800,1000,1200,1400,1600] as const;
export type BlockChoice='direct'|'detour'|'skip';
export type BlockPlan={version:typeof BLOCK_RULE;seed:number;candidateSetId:typeof CANDIDATE_SET;blocks:{heightCm:number;first:'low'|'high';midpointTie:'lower'|'upper';aRoutes:('direct'|'detour')[]}[]};
export type BlockAnswer={submissionId:string;trialSequence:number;choice:BlockChoice;scenario:{height:number;detour:number}};
export type BlockQuestion={sequence:number;blockIndex:number;trialInBlock:number;heightCm:number;detourMm:number;aRoute:'direct'|'detour';reason:string;endpointOrder:string;context:{prior:{detourMm:number;choice:BlockChoice}[];state:string;candidatesMm:readonly number[]}};
function rng(seed:number){let x=seed>>>0;return()=>{x+=0x6D2B79F5;let t=x;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
function shuffle<T>(a:T[],r:()=>number):T[]{const b=[...a];for(let i=b.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[b[i],b[j]]=[b[j],b[i]];}return b;}
export function createBlockPlan(seed:number,heightsCm:number[]=[5,7,9,11]):BlockPlan{
  if(!Number.isInteger(seed)||seed<0||seed>0xffffffff||!heightsCm.length||new Set(heightsCm).size!==heightsCm.length||heightsCm.some(h=>![5,7,9,11].includes(h)))throw new Error('높이별 질문 설정을 확인해 주세요.');
  const r=rng(seed),heights=shuffle(heightsCm,r),starts=shuffle(heights.map((_,i)=>i%2===0?'low' as const:'high' as const),r);
  return {version:BLOCK_RULE,seed,candidateSetId:CANDIDATE_SET,blocks:heights.map((heightCm,i)=>({heightCm,first:starts[i],midpointTie:r()<.5?'lower':'upper',aRoutes:shuffle(['direct','direct','detour','detour'] as ('direct'|'detour')[],r)}))};
}
export function validBlockPlan(p:unknown,heightsCm:number[]=[5,7,9,11]):p is BlockPlan{
  try{const x=p as BlockPlan;return JSON.stringify(x)===JSON.stringify(createBlockPlan(x.seed,heightsCm));}catch{return false;}
}
export const questionCount=(p:BlockPlan)=>p.blocks.length*4;
function selectDistance(prior:{detourMm:number;choice:BlockChoice}[],block:BlockPlan['blocks'][number]):{distance:number;reason:string;state:string}{
  const low=DETOURS_MM[0],high=DETOURS_MM[DETOURS_MM.length-1];
  if(prior.length<2){const first=block.first==='low'?low:high;return {distance:prior.length===0?first:(first===low?high:low),reason:prior.length===0?'first_endpoint':'opposite_endpoint',state:'range_check'};}
  const valid=prior.filter(a=>a.choice!=='skip');
  const count=(d:number)=>prior.filter(a=>a.detourMm===d).length;
  const order=(a:number,b:number)=>count(a)-count(b)||(block.midpointTie==='lower'?a-b:b-a);
  const missing=[low,high].filter(d=>!valid.some(a=>a.detourMm===d));
  if(missing.length)return {distance:missing.sort(order)[0],reason:'skipped_endpoint_recheck',state:'missing_endpoint'};
  const yes=valid.filter(a=>a.choice==='detour').map(a=>a.detourMm),no=valid.filter(a=>a.choice==='direct').map(a=>a.detourMm);
  if(!yes.length)return {distance:low,reason:'lower_endpoint_recheck',state:'all_direct'};
  if(!no.length)return {distance:high,reason:'upper_endpoint_recheck',state:'all_detour'};
  const lo=Math.max(...yes),hi=Math.min(...no);
  // Apparent contradiction is retained, never fixed by deleting an answer.
  if(lo>=hi)return {distance:[...new Set([lo,hi])].sort(order)[0],reason:'conflict_recheck',state:'inconsistent'};
  const interior=DETOURS_MM.filter(d=>d>lo&&d<hi);
  if(interior.length){const midpoint=(lo+hi)/2;return {distance:[...interior].sort((a,b)=>Math.abs(a-midpoint)-Math.abs(b-midpoint)||order(a,b))[0],reason:'midpoint_probe',state:'opposite_choices'};}
  return {distance:[lo,hi].sort(order)[0],reason:'adjacent_candidate_recheck',state:'adjacent_candidates'};
}
function at(plan:BlockPlan,answers:BlockAnswer[]):BlockQuestion|null{
  const i=answers.length;if(i>=questionCount(plan))return null;
  const b=Math.floor(i/4),t=i%4,block=plan.blocks[b];
  const prior=answers.slice(b*4).map(a=>({detourMm:Math.round(a.scenario.detour*1000),choice:a.choice}));
  const next=selectDistance(prior,block);
  return {sequence:i+1,blockIndex:b+1,trialInBlock:t+1,heightCm:block.heightCm,detourMm:next.distance,aRoute:block.aRoutes[t],reason:next.reason,endpointOrder:block.first==='low'?'low_high':'high_low',context:{prior,state:next.state,candidatesMm:DETOURS_MM}};
}
/** Reconstruct from acknowledged, ordered raw answers. Resuming never re-randomizes. */
export function nextBlockQuestion(plan:BlockPlan,answers:BlockAnswer[]):BlockQuestion|null{
  if(plan.version!==BLOCK_RULE||plan.candidateSetId!==CANDIDATE_SET||answers.length>questionCount(plan))throw new Error('질문 기록 버전이 맞지 않습니다.');
  const prefix:BlockAnswer[]=[],ids=new Set<string>();
  for(const answer of answers){
    const q=at(plan,prefix)!;
    if(!answer.submissionId||ids.has(answer.submissionId)||answer.trialSequence!==q.sequence||!['direct','detour','skip'].includes(answer.choice)||Math.abs(answer.scenario.height-q.heightCm/100)>1e-9||Math.abs(answer.scenario.detour-q.detourMm/1000)>1e-9)throw new Error('저장된 질문 순서와 답변이 맞지 않습니다. 연구자에게 알려 주세요.');
    ids.add(answer.submissionId);prefix.push(answer);
  }
  return at(plan,prefix);
}
/** Persist the immutable next session before advancing memory/UI. Retry is idempotent. */
export function acknowledgeAnswer<T extends {index:number;responses:Record<string,unknown>[];pending?:Record<string,unknown>}>(state:T,persist:(next:T)=>void):T{
  if(!state.pending)throw new Error('저장 확인할 답변이 없습니다.');
  const p=state.pending,found=state.responses.find(r=>r.submissionId===p.submissionId);
  if(found&&JSON.stringify(found)!==JSON.stringify(p))throw new Error('같은 ID의 답변 내용이 다릅니다.');
  const responses=found?state.responses:[...state.responses,p];
  const next={...state,responses,index:responses.length,pending:undefined};persist(next);return next;
}
