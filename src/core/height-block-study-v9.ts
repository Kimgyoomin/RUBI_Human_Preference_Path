/** Question scheduling only. No cost estimate, posterior or confidence interval. */
export const BLOCK_PROTOCOL='height-blocks-no-repeat-v9';
export const BLOCK_LABEL_CONDITION='same-policy-intro-no-repeat-binary-v3';
export const BLOCK_RULE='endpoint-unseen-v1';
export const CANDIDATE_SET='detour-400-2400-step200-v2';
export const COLLECTOR_VERSION='repairable-block-collector-v7';
export const DETOURS_MM=[400,600,800,1000,1200,1400,1600,1800,2000,2200,2400] as const;
export type BlockChoice='direct'|'detour'|'skip';
export type BlockPlan={version:typeof BLOCK_RULE;seed:number;candidateSetId:typeof CANDIDATE_SET;blocks:{heightCm:number;first:'low'|'high';midpointTie:'lower'|'upper';aRoutes:('direct'|'detour')[]}[]};
export type BlockAnswer={submissionId:string;trialSequence:number;choice:BlockChoice;scenario:{height:number;detour:number}};
export type BlockQuestion={sequence:number;blockIndex:number;trialInBlock:number;heightCm:number;detourMm:number;aRoute:'direct'|'detour';reason:string;endpointOrder:string;context:{prior:{detourMm:number;choice:BlockChoice}[];state:string;candidatesMm:readonly number[]}};
function rng(seed:number){let x=seed>>>0;return()=>{x+=0x6D2B79F5;let t=x;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
function shuffle<T>(a:T[],r:()=>number):T[]{const b=[...a];for(let i=b.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[b[i],b[j]]=[b[j],b[i]];}return b;}
export function createBlockPlan(seed:number,heightsCm:number[]=[5,7,9,11]):BlockPlan{
  if(!Number.isInteger(seed)||seed<0||seed>0xffffffff||!heightsCm.length||new Set(heightsCm).size!==heightsCm.length||heightsCm.some(h=>![5,7,9,11].includes(h)))throw new Error('높이별 질문 설정을 확인해 주세요.');
  const r=rng(seed),heights=shuffle([...heightsCm].sort((a,b)=>a-b),r),starts=shuffle(heights.map((_,i)=>i%2===0?'low' as const:'high' as const),r);
  return {version:BLOCK_RULE,seed,candidateSetId:CANDIDATE_SET,blocks:heights.map((heightCm,i)=>({heightCm,first:starts[i],midpointTie:r()<.5?'lower':'upper',aRoutes:shuffle(['direct','direct','detour','detour'] as ('direct'|'detour')[],r)}))};
}
export function validBlockPlan(p:unknown,heightsCm:number[]=[5,7,9,11]):p is BlockPlan{
  try{const x=p as BlockPlan;return JSON.stringify(x)===JSON.stringify(createBlockPlan(x.seed,heightsCm));}catch{return false;}
}
export const questionCount=(p:BlockPlan)=>p.blocks.length*4;
/** Four DIFFERENT conditions per height. A skip is still a presented condition.
 * No response is removed or converted to a deterministic cost bound. */
function selectDistance(prior:{detourMm:number;choice:BlockChoice}[],block:BlockPlan['blocks'][number]):{distance:number;reason:string;state:string}{
  const low=DETOURS_MM[0],high=DETOURS_MM[DETOURS_MM.length-1];
  if(prior.length<2){const first=block.first==='low'?low:high;return {distance:prior.length===0?first:(first===low?high:low),reason:prior.length===0?'first_endpoint':'opposite_endpoint',state:'range_check'};}
  const shown=new Set(prior.map(a=>a.detourMm));
  const unused=DETOURS_MM.filter(d=>!shown.has(d));
  if(!unused.length)throw new Error('아직 제시하지 않은 거리 후보가 없습니다.');
  const tie=(a:number,b:number)=>block.midpointTie==='lower'?a-b:b-a;
  // A coverage probe maximizes distance to already displayed stimuli, then
  // chooses the candidate closest to the full-range centre. Fully deterministic.
  const coverage=(reason:string,state:string)=>{
    const gap=(d:number)=>Math.min(...prior.map(a=>Math.abs(d-a.detourMm)));
    const centre=(low+high)/2;
    return {distance:[...unused].sort((a,b)=>gap(b)-gap(a)||Math.abs(a-centre)-Math.abs(b-centre)||tie(a,b))[0],reason,state};
  };
  const valid=prior.filter(a=>a.choice!=='skip');
  if(valid.length!==prior.length)return coverage('unseen_after_skip','incomplete_observations');
  const yes=valid.filter(a=>a.choice==='detour').map(a=>a.detourMm);
  const no=valid.filter(a=>a.choice==='direct').map(a=>a.detourMm);
  if(!yes.length)return {distance:unused[0],reason:'unseen_low_probe',state:'all_direct_observed'};
  if(!no.length)return {distance:unused[unused.length-1],reason:'unseen_high_probe',state:'all_detour_observed'};
  const lo=Math.max(...yes),hi=Math.min(...no);
  if(lo>=hi)return coverage('unseen_conflict_probe','inconsistent_observations');
  const interior=unused.filter(d=>d>lo&&d<hi);
  if(interior.length){const midpoint=(lo+hi)/2;return {distance:[...interior].sort((a,b)=>Math.abs(a-midpoint)-Math.abs(b-midpoint)||tie(a,b))[0],reason:'unseen_midpoint_probe',state:'opposite_choices'};}
  return coverage('unseen_coverage_probe','no_unseen_interior');
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
  if(!validBlockPlan(plan,plan.blocks?.map(b=>b.heightCm))||answers.length>questionCount(plan))throw new Error('질문 기록 버전이 맞지 않습니다.');
  const prefix:BlockAnswer[]=[],ids=new Set<string>();
  for(const answer of answers){
    const q=at(plan,prefix)!;
    if(!answer.submissionId||ids.has(answer.submissionId)||answer.trialSequence!==q.sequence||!['direct','detour','skip'].includes(answer.choice)||!Number.isFinite(answer.scenario.height)||!Number.isFinite(answer.scenario.detour)||Math.abs(answer.scenario.height-q.heightCm/100)>1e-9||Math.abs(answer.scenario.detour-q.detourMm/1000)>1e-9)throw new Error('저장된 질문 순서와 답변이 맞지 않습니다. 연구자에게 알려 주세요.');
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
