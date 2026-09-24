/** Labels data-collection purpose only; never grants access or enables the server. */
export const UI_CHECK_PHASE = 'owner-ui-check-v1';
export const UI_CHECK_PREFIX = 'ui-check-';
export function isUiCheckStudy(study:{collectionPhase?:string}):boolean {
  return study.collectionPhase === UI_CHECK_PHASE;
}
export function collectionStorageKey(experimentId:string,protocol:string,uiCheck:boolean):string {
  return `RUBI_Human_Preference_Path:${experimentId}:${protocol}${uiCheck?':'+UI_CHECK_PHASE:''}`;
}
export function createSessionId(uiCheck:boolean,uuid:string=crypto.randomUUID()):string {
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid))throw new Error('참여 ID를 만들지 못했습니다.');
  return (uiCheck?UI_CHECK_PREFIX:'')+uuid;
}
export function sessionMatchesPurpose(id:unknown,uiCheck:boolean):boolean {
  return typeof id==='string' && new RegExp('^'+(uiCheck?UI_CHECK_PREFIX:'')+'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$','i').test(id);
}
