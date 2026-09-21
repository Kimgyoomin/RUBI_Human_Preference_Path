import type { Scenario } from './scenario.ts';
export type Bundle = { xml:string; files:Map<string,Uint8Array>; hashes:Record<string,string>; name:string };
const normal = (s:string) => s.replaceAll('\\','/').replace(/^\.\//,'');
export function xmlDocument(xml:string): XMLDocument {
  if(/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('외부 XML entity는 지원하지 않습니다.');
  const doc=new DOMParser().parseFromString(xml,'application/xml');
  if(doc.querySelector('parsererror') || doc.documentElement.tagName!=='mujoco') throw new Error('유효한 MuJoCo XML이 아닙니다.');
  return doc;
}
export function references(xml:string): {files:string[]; worlds:string[]} {
  const doc=xmlDocument(xml),compiler=doc.querySelector('compiler');
  const meshdir=compiler?.getAttribute('meshdir')||'';
  const texturedir=compiler?.getAttribute('texturedir')||'';
  const files=Array.from(doc.querySelectorAll('asset [file]')).map(e=>normal([e.tagName==='mesh'?meshdir:e.tagName==='texture'?texturedir:'',e.getAttribute('file')].filter(Boolean).join('/')));
  const worlds=Array.from(doc.documentElement.children).filter(e=>e.tagName==='include').map(e=>e.getAttribute('file')||'');
  return {files:[...new Set(files)],worlds};
}
export async function loadFiles(input:File[]): Promise<Bundle> {
  const xmlFile=input.find(f=>f.name.toLowerCase()==='rubi.xml')||input.find(f=>f.name.toLowerCase().endsWith('.xml'));
  if(!xmlFile) throw new Error('rubi.xml을 선택하세요.');
  const xml=await xmlFile.text(); const refs=references(xml);
  const files=new Map<string,Uint8Array>(),hashes:Record<string,string>={};
  const requirements=[...refs.files,'encoder.onnx','policy.onnx'];
  const missing:string[]=[];
  for(const wanted of requirements) {
    const matches=input.filter(f=>normal(f.webkitRelativePath||f.name).endsWith('/'+wanted)||normal(f.webkitRelativePath||f.name)===wanted||f.name===wanted.split('/').at(-1));
    if(matches.length>1) throw new Error(`${wanted}: 같은 이름의 파일이 여러 개입니다.`);
    if(!matches.length) { missing.push(wanted); continue; }
    const bytes=new Uint8Array(await matches[0].arrayBuffer()); files.set(wanted,bytes);
    hashes[wanted]=await sha256(bytes);
  }
  if(missing.length) throw new Error('필요한 파일: '+missing.join(', '));
  hashes['rubi.xml']=await sha256(new TextEncoder().encode(xml));
  return {xml,files,hashes,name:xmlFile.name};
}
export async function sha256(bytes:Uint8Array): Promise<string> {
  const digest=await crypto.subtle.digest('SHA-256',new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
}

const MUJOCO_STL_FACE_LIMIT=200000;
const WEB_STL_CHUNK_FACES=180000;

function binaryStlFaces(bytes:Uint8Array): number|undefined {
  if(bytes.byteLength<84)return undefined;
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const faces=view.getUint32(80,true);
  return 84+faces*50===bytes.byteLength?faces:undefined;
}

function splitBinaryStl(bytes:Uint8Array,faces:number):Uint8Array[] {
  const result:Uint8Array[]=[];
  for(let start=0;start<faces;start+=WEB_STL_CHUNK_FACES) {
    const count=Math.min(WEB_STL_CHUNK_FACES,faces-start);
    const part=new Uint8Array(84+count*50);
    part.set(bytes.subarray(0,80),0);
    new DataView(part.buffer).setUint32(80,count,true);
    part.set(bytes.subarray(84+start*50,84+(start+count)*50),84);
    result.push(part);
  }
  return result;
}

/**
 * MuJoCo's STL decoder rejects a single STL above 200k faces.
 * For visual-only meshes we split the binary STL in memory and duplicate
 * the visual geom references. Geometry is not decimated or rescaled.
 */
export function prepareVisualStlMeshes(source:string,input:Map<string,Uint8Array>):{xml:string;files:Map<string,Uint8Array>;split:string[]} {
  const doc=xmlDocument(source),compiler=doc.querySelector('compiler');
  const meshdir=normal(compiler?.getAttribute('meshdir')||'');
  const files=new Map(input),split:string[]=[];
  const meshes=Array.from(doc.querySelectorAll('asset mesh[file]'));
  for(const mesh of meshes) {
    const fileAttr=mesh.getAttribute('file')||'';
    const path=normal([meshdir,fileAttr].filter(Boolean).join('/'));
    const bytes=files.get(path);
    if(!bytes || !/\.stl$/i.test(fileAttr))continue;
    const faces=binaryStlFaces(bytes);
    if(faces===undefined || faces<=MUJOCO_STL_FACE_LIMIT)continue;
    const meshName=mesh.getAttribute('name');
    if(!meshName)throw new Error(`${path}: mesh name이 없습니다.`);
    const refs=Array.from(doc.querySelectorAll('geom[mesh]')).filter(g=>g.getAttribute('mesh')===meshName);
    if(!refs.length)continue;
    const visualOnly=refs.every(g=>g.getAttribute('class')==='visualgeom' || (g.getAttribute('contype')==='0'&&g.getAttribute('conaffinity')==='0'));
    if(!visualOnly)throw new Error(`${path}: ${faces} faces입니다. 충돌 mesh는 자동 분할하지 않습니다. 200000 faces 이하로 준비해 주세요.`);

    const parts=splitBinaryStl(bytes,faces);
    const dot=fileAttr.lastIndexOf('.');
    const stem=dot>=0?fileAttr.slice(0,dot):fileAttr;
    const ext=dot>=0?fileAttr.slice(dot):'.STL';
    const names=parts.map((part,i)=>{
      const file=`${stem}.__webpart${i}${ext}`;
      const key=normal([meshdir,file].filter(Boolean).join('/'));
      files.set(key,part);
      return {name:`${meshName}__webpart${i}`,file,key};
    });
    files.delete(path);

    const parent=mesh.parentNode!;
    names.forEach(({name,file},i)=>{
      const node=mesh.cloneNode(true) as Element;
      node.setAttribute('name',name);node.setAttribute('file',file);
      if(i===0)parent.replaceChild(node,mesh);else parent.insertBefore(node,(names.length&&parent.childNodes)?null:null);
    });
    // insertBefore(null) appends, but keep the generated mesh assets together:
    let anchor=Array.from(parent.childNodes).find(n=>(n as Element).getAttribute?.('name')===names[0].name) ?? null;
    for(let i=1;i<names.length;i++) {
      const node=Array.from(parent.childNodes).find(n=>(n as Element).getAttribute?.('name')===names[i].name);
      if(node&&anchor){parent.removeChild(node);parent.insertBefore(node,anchor.nextSibling);anchor=node;}
    }

    for(const geom of refs) {
      geom.setAttribute('mesh',names[0].name);
      let anchor:Node=geom;
      for(let i=1;i<names.length;i++) {
        const clone=geom.cloneNode(true) as Element;
        clone.setAttribute('mesh',names[i].name);
        anchor.parentNode!.insertBefore(clone,anchor.nextSibling);anchor=clone;
      }
    }
    split.push(`${path}: ${faces} faces -> ${parts.length} visual chunks`);
  }
  return {xml:new XMLSerializer().serializeToString(doc),files,split};
}

export function sceneXml(source:string,s:Scenario): {xml:string; removed:string[]} {
  const doc=xmlDocument(source),root=doc.documentElement,removed:string[]=[];
  for(const e of Array.from(root.children)) if(e.tagName==='include') {
    const name=e.getAttribute('file')||'';
    if(!/world|terrain|stair|lrc_/i.test(name)) throw new Error(`추가 include가 필요합니다: ${name}`);
    removed.push(name); e.remove();
  }
  if(doc.querySelector('include')) throw new Error('로봇 내부 include는 하나의 XML로 합쳐 주세요.');
  const world=doc.querySelector('worldbody'); if(!world) throw new Error('worldbody가 없습니다.');
  const option=doc.querySelector('option');
  if(option?.getAttribute('timestep') && Math.abs(Number(option.getAttribute('timestep'))-0.002)>1e-10) throw new Error('물리 timestep은 terrain 정책과 같은 0.002초여야 합니다.');
  if(!option) { const e=doc.createElement('option'); e.setAttribute('timestep','0.002'); root.insertBefore(e,root.firstChild); }
  else option.setAttribute('timestep','0.002');
  if(!Array.from(world.children).some(e=>e.tagName==='geom'&&e.getAttribute('type')==='plane')) {
    const floor=doc.createElement('geom'); Object.entries({name:'hpp_floor',type:'plane',size:'10 10 .1',contype:'1',conaffinity:'15',friction:'0.9 0.9 0.0001'}).forEach(([k,v])=>floor.setAttribute(k,v));world.appendChild(floor);
  }
  if(s.height>0) {
    const step=doc.createElement('geom');
    Object.entries({name:'hpp_platform',type:'box',pos:`3 0 ${s.height/2}`,size:`${s.depth/2} ${s.width/2} ${s.height/2}`,rgba:'0.35 0.48 0.56 1',contype:'1',conaffinity:'15',friction:'0.9 0.9 0.0001'}).forEach(([k,v])=>step.setAttribute(k,v));
    world.appendChild(step);
  }
  return {xml:new XMLSerializer().serializeToString(doc),removed};
}
