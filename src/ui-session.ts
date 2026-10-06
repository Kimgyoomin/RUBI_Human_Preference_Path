/** Collection-purpose labels never grant admin access or enable server writes. */
export const UI_CHECK_PHASE = 'owner-ui-check-v1';
export const UI_CHECK_PREFIX = 'ui-check-';
// v2 intentionally rotates only the browser namespace after the 2026-10-06 live-sheet reset.
// Existing external-pilot-v1 tabs keep their already-loaded bundle/session and server records.
export const EXTERNAL_PILOT_PHASE = 'external-pilot-v2';
export const EXTERNAL_PILOT_PREFIX = 'pilot-';
export type CollectionPurpose = typeof UI_CHECK_PHASE | typeof EXTERNAL_PILOT_PHASE | 'survey';
type PurposeInput = boolean | CollectionPurpose;
export function isUiCheckStudy(study:{collectionPhase?:string}):boolean {
  return study.collectionPhase === UI_CHECK_PHASE;
}
export function isExternalPilotStudy(study:{collectionPhase?:string}):boolean {
  return study.collectionPhase === EXTERNAL_PILOT_PHASE;
}
export function collectionPurpose(study:{collectionPhase?:string}):CollectionPurpose {
  if(isUiCheckStudy(study))return UI_CHECK_PHASE;
  if(isExternalPilotStudy(study))return EXTERNAL_PILOT_PHASE;
  if(study.collectionPhase===undefined)return 'survey';
  throw new Error('설문 수집 단계 설정을 확인해 주세요.');
}
function normalize(p:PurposeInput):CollectionPurpose {
  if(p===true)return UI_CHECK_PHASE;
  if(p===false)return 'survey';
  if(p===UI_CHECK_PHASE||p===EXTERNAL_PILOT_PHASE||p==='survey')return p;
  throw new Error('유효하지 않은 수집 단계입니다.');
}
function prefix(p:PurposeInput):string {
  const purpose=normalize(p);
  return purpose===UI_CHECK_PHASE?UI_CHECK_PREFIX:purpose===EXTERNAL_PILOT_PHASE?EXTERNAL_PILOT_PREFIX:'';
}
export function collectionStorageKey(experimentId:string,protocol:string,purpose:PurposeInput):string {
  const p=normalize(purpose);
  return `RUBI_Human_Preference_Path:${experimentId}:${protocol}${p==='survey'?'':':'+p}`;
}
export function createSessionId(purpose:PurposeInput,uuid:string=crypto.randomUUID()):string {
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid))throw new Error('참여 ID를 만들지 못했습니다.');
  return prefix(purpose)+uuid;
}
export function sessionMatchesPurpose(id:unknown,purpose:PurposeInput):boolean {
  return typeof id==='string' && new RegExp('^'+prefix(purpose)+'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$','i').test(id);
}
