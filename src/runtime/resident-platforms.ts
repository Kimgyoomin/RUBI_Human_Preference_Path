import { xmlDocument } from '../core/model.ts';
import type { Scenario } from '../core/scenario.ts';

// Studio keeps its 0..12 cm slider; the study chooses a validated subset.
export const PLATFORM_HEIGHTS_CM = Array.from({length:12},(_,i)=>i+1);
export const platformName = (cm:number) => `hpp_platform_${cm}cm`;
export function heightCentimetres(height:number):number {
  const cm=Math.round(height*100);
  if(!Number.isFinite(height)||cm<0||cm>12||Math.abs(height-cm/100)>1e-8) {
    throw new Error('상주 지형은 0–12 cm의 1 cm 간격만 지원합니다.');
  }
  return cm;
}

/** Add fixed-size world geoms once. Only masks change between trials; no
 * geom_size edits, mesh re-imports, moving terrain, or mass/inertia changes. */
export function residentSceneXml(source:string,s:Scenario):string {
  heightCentimetres(s.height);
  const doc=xmlDocument(source),world=doc.querySelector('worldbody');
  if(!world)throw new Error('worldbody가 없습니다.');
  for(const e of Array.from(world.querySelectorAll('geom[name="hpp_platform"]')))e.remove();
  for(const cm of PLATFORM_HEIGHTS_CM){
    const h=cm/100,e=doc.createElement('geom');
    const attrs={name:platformName(cm),type:'box',pos:`3 0 ${h/2}`,size:`${s.depth/2} ${s.width/2} ${h/2}`,
      rgba:'0.35 0.48 0.56 1',contype:'1',conaffinity:'15',friction:'0.9 0.9 0.0001'};
    Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,v));world.appendChild(e);
  }
  return new XMLSerializer().serializeToString(doc);
}

/** Set BOTH masks and refresh parent-body mask unions, as required by MuJoCo.
 * Called only while physics is stopped, immediately before a full data reset. */
export function activatePlatform(model:any,ids:number[],height:number):void {
  const cm=heightCentimetres(height);
  if(ids.length!==12)throw new Error('지형 bank의 geom 수가 다릅니다.');
  const parents=new Set<number>();
  for(let i=0;i<ids.length;i++){
    const id=ids[i],active=i+1===cm;
    model.geom_contype[id]=active?1:0;
    model.geom_conaffinity[id]=active?15:0;
    parents.add(model.geom_bodyid[id]);
  }
  // On versions which expose aggregate masks, keep them consistent. In this
  // scene the bank belongs to worldbody and floor already supplies bits 1/15.
  for(const body of parents){
    let type=0,affinity=0;
    for(let g=0;g<model.ngeom;g++)if(model.geom_bodyid[g]===body){
      type|=model.geom_contype[g];affinity|=model.geom_conaffinity[g];
    }
    if(model.body_contype)model.body_contype[body]=type;
    if(model.body_conaffinity)model.body_conaffinity[body]=affinity;
  }
}
