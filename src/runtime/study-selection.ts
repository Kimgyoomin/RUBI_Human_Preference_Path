import {collectionStorageKey,isUiCheckStudy} from '../ui-session.ts';
import {questionProtocol} from '../core/question-protocol.ts';
export type StudyConfig={id:string;status:'draft'|'released';protocolVersion:string;responseApi:string;requiredReleaseVersion?:string;datasetTag?:string;collectionPhase?:string;legacyStudyUrl?:string;[key:string]:any};
/** Selection does not alter or migrate either session. Corrupt state fails closed. */
export function chooseStudy(current:StudyConfig,legacy:StudyConfig|undefined,store:Pick<Storage,'getItem'>,requested:string|null):StudyConfig {
  if(requested && !['current','legacy-v7'].includes(requested))throw new Error('설문 버전 선택을 확인해 주세요.');
  if(requested==='legacy-v7'){
    if(!legacy)throw new Error('기존 설문 설정을 찾지 못했습니다.');return legacy;
  }
  if(requested==='current'||!legacy)return current;
  const unfinished=(s:StudyConfig)=>{
    const raw=store.getItem(collectionStorageKey(s.id,s.protocolVersion,isUiCheckStudy(s)));
    if(!raw)return false;
    let value:any;try{value=JSON.parse(raw);}catch{throw new Error('저장된 참여 기록이 손상되었습니다. 기록을 지우지 말고 연구자에게 알려 주세요.');}
    return value?.complete!==true && (value?.consent===true||Boolean(value?.pending)||(value?.responses?.length??0)>0);
  };
  if(unfinished(current))return current;
  return unfinished(legacy)?legacy:current;
}
let loaded:Promise<StudyConfig>|undefined;
export function loadStudy():Promise<StudyConfig>{
  return loaded??=(async()=>{
    const base=new URL(import.meta.env.BASE_URL,location.href);
    async function read(url:URL){const r=await fetch(url,{cache:'no-cache'});if(!r.ok)throw new Error('설문 설정을 불러오지 못했습니다.');return await r.json() as StudyConfig;}
    const current=await read(new URL('study.json',base));
    let legacy:StudyConfig|undefined;
    if(current.legacyStudyUrl){
      if(current.legacyStudyUrl!=='./study.legacy-v7.json')throw new Error('기존 참여 설정 주소가 다릅니다.');
      legacy=await read(new URL(current.legacyStudyUrl,base));
      if(legacy.id!==current.id||legacy.responseApi!==current.responseApi||legacy.protocolVersion!=='height-blocks-binary-v7')throw new Error('기존 참여의 저장 설정이 다릅니다.');
    }
    const selected=chooseStudy(current,legacy,localStorage,new URLSearchParams(location.search).get('protocol'));
    questionProtocol(selected.protocolVersion);
    return selected;
  })();
}
