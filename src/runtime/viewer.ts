import * as T from 'three';
import { meshGeometry } from './mesh-geometry.ts';
import { sampleRoute } from '../core/scenario.ts';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Scenario, RouteKey } from '../core/scenario.ts';
import type { Physics } from './physics.ts';

export type CameraPreset='overview'|'step'|'top'|'follow';
export const CAMERA_PROTOCOL='rear-oblique-world-heading-30fps-v1';
export class Viewer {
  renderer:T.WebGLRenderer;scene=new T.Scene();camera=new T.PerspectiveCamera(42,1,0.01,150);
  controls:OrbitControls;world=new T.Group();robot=new T.Group();robotMeshes:{id:number;mesh:T.Mesh}[]=[];
  engine:Physics|undefined;animation=0;observer:ResizeObserver;canvas:HTMLCanvasElement;selected:RouteKey|undefined;
  aKey:RouteKey='direct';onFrame:(time:number)=>void=()=>{};
  private following=false;private fixedView=false;private lastCameraWall=0;private lastRender=0;private worldKey='';
  private focus=new T.Vector3(0,0,0);
  private offset=new T.Vector3(-2.8,-2.1,1.75);
  private ahead=new T.Vector3(1.1,0,0.43);
  constructor(canvas:HTMLCanvasElement) {
    this.canvas=canvas;this.renderer=new T.WebGLRenderer({canvas,antialias:true,alpha:false});
    this.renderer.setPixelRatio(1);this.renderer.setClearColor('#e7edf0');
    this.renderer.shadowMap.enabled=false;this.camera.up.set(0,0,1);
    this.controls=new OrbitControls(this.camera,canvas);this.controls.enableDamping=true;
    this.controls.minDistance=0.6;this.controls.maxDistance=24;this.controls.maxPolarAngle=Math.PI/2-0.02;
    this.controls.addEventListener('start',()=>{if(!this.fixedView)this.following=false;});
    this.scene.add(new T.HemisphereLight(0xffffff,0x627784,2));
    const sun=new T.DirectionalLight(0xffffff,2.6);sun.position.set(1,-3,8);this.scene.add(sun);
    this.scene.add(this.world,this.robot);this.setCamera('overview');
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(canvas.parentElement!);this.resize();
    const frame=(time:number)=>{
      this.animation=requestAnimationFrame(frame);this.onFrame(time);
      // Rendering cadence is independent of 500 Hz physics / 100 Hz inference.
      if(document.hidden||time-this.lastRender<1000/30)return;
      this.lastRender=time;this.followCamera(time);this.controls.update();this.renderer.render(this.scene,this.camera);
    };
    this.animation=requestAnimationFrame(frame);
  }
  resize(){const r=this.canvas.parentElement!.getBoundingClientRect();if(r.width<1||r.height<1)return;this.renderer.setSize(r.width,r.height,false);this.camera.aspect=r.width/r.height;this.camera.updateProjectionMatrix();}
  clear(group:T.Group){
    const geometry=new Set<T.BufferGeometry>(),materials=new Set<T.Material>();
    group.traverse(o=>{
      if(o instanceof T.Mesh||o instanceof T.Line){geometry.add(o.geometry);(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>materials.add(m));}
      if(o instanceof T.Sprite){o.material.map?.dispose();materials.add(o.material);}
    });geometry.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());group.clear();
  }
  private startGoalMarkers(){
    const add=(geometry:T.BufferGeometry,color:number,x:number,z:number,name:string)=>{
      const marker=new T.Mesh(geometry,new T.MeshBasicMaterial({color,side:T.DoubleSide}));marker.position.set(x,0,z);marker.name=name;this.world.add(marker);
    };
    add(new T.CircleGeometry(.21,48),0x168d4d,0,.009,'start-green-disc');
    add(new T.RingGeometry(.215,.24,48),0x244536,0,.010,'start-border');
    add(new T.RingGeometry(.14,.23,48),0xce3449,6,.009,'goal-red-target');
    add(new T.CircleGeometry(.065,32),0xce3449,6,.010,'goal-centre');
    add(new T.RingGeometry(.235,.25,48),0x59232d,6,.011,'goal-border');
  }
  private emphasizePaths(){
    for(const object of this.world.children){
      const key=object.userData.routeKey as RouteKey|undefined;if(!key)continue;
      const active=!this.selected||this.selected===key;
      if(object instanceof T.Line)(object.material as T.LineBasicMaterial).opacity=active?1:.22;
      else if(object instanceof T.Mesh)(object.material as T.MeshBasicMaterial).opacity=active?.85:.18;
    }
  }
  setScenario(s:Scenario,selected?:RouteKey){
    this.selected=selected;
    const key=`${s.id}:${this.aKey}`;
    // Changing A/B emphasis must not dispose/recompile geometry and shaders.
    if(key===this.worldKey){this.emphasizePaths();return;}
    this.clear(this.world);this.worldKey=key;
    const floor=new T.Mesh(new T.PlaneGeometry(28,22),new T.MeshStandardMaterial({color:'#e7edf0',roughness:1}));floor.position.set(3,0,-.004);this.world.add(floor);
    const grid=new T.GridHelper(24,24,0xa4b7c0,0xcad6dc);grid.rotation.x=Math.PI/2;grid.position.set(3,0,0);this.world.add(grid);
    if(s.height>0){
      const box=new T.Mesh(new T.BoxGeometry(s.depth,s.width,s.height),new T.MeshStandardMaterial({color:'#738d9b',roughness:.82}));box.position.set(3,0,s.height/2);this.world.add(box);
      const edges=new T.LineSegments(new T.EdgesGeometry(box.geometry),new T.LineBasicMaterial({color:'#334e5e'}));edges.position.copy(box.position);this.world.add(edges);
    }
    for(const route of ['direct','detour'] as const){
      const color=route===this.aKey?0x087d79:0xcc6640;
      const points=s.routes[route].map(p=>new T.Vector3(p[0],p[1],.02));
      const line=new T.Line(new T.BufferGeometry().setFromPoints(points),new T.LineBasicMaterial({color,transparent:true}));line.userData.routeKey=route;this.world.add(line);
      for(const p of sampleRoute(s.routes[route],.12)){
        const marker=new T.Mesh(new T.SphereGeometry(.026,8,6),new T.MeshBasicMaterial({color,transparent:true}));marker.position.set(p[0],p[1],.02);marker.userData.routeKey=route;this.world.add(marker);
      }
    }
    this.startGoalMarkers();this.emphasizePaths();
    // No Sprite/canvas text labels: no cm, START, GOAL or path lengths.
  }
  setParticipantView(enabled:boolean){this.fixedView=enabled;this.controls.enabled=!enabled;this.controls.enableDamping=!enabled;if(enabled)this.setCamera('follow');}
  resetFollow(pos:number[]=[0,0,0]){
    this.focus.set(pos[0],pos[1],0);this.lastCameraWall=0;
    this.camera.position.copy(this.focus).add(this.offset);this.controls.target.copy(this.focus).add(this.ahead);this.controls.update();
  }
  private followCamera(now:number){
    if(!this.following||!this.engine||!this.robot.visible){this.lastCameraWall=0;return;}
    const p=this.engine.position(),dt=this.lastCameraWall?Math.min(.05,(now-this.lastCameraWall)/1000):0;this.lastCameraWall=now;
    const alpha=1-Math.exp(-dt/.22);
    this.focus.x+=(p[0]-this.focus.x)*alpha;this.focus.y+=(p[1]-this.focus.y)*alpha;
    this.camera.position.copy(this.focus).add(this.offset);this.controls.target.copy(this.focus).add(this.ahead);
  }
  setCamera(preset:CameraPreset){
    this.following=preset==='follow';this.lastCameraWall=0;
    if(preset==='follow'){this.resetFollow(this.engine?.position());return;}
    if(preset==='overview'){this.camera.position.set(-3.2,-4.6,3.7);this.controls.target.set(3,.35,.25);}
    if(preset==='step'){this.camera.position.set(.9,-1.7,1.3);this.controls.target.set(3,0,.35);}
    if(preset==='top'){this.camera.position.set(3,-.01,9);this.controls.target.set(3,0,0);}
    this.controls.update();
  }
  attach(engine:Physics){
    this.clear(this.robot);this.robotMeshes=[];this.engine=engine;
    const m=engine.model,meshCache=new Map<number,T.BufferGeometry>();
    for(let id=0;id<m.ngeom;id++){
      if(m.geom_bodyid[id]===0||m.geom_rgba[id*4+3]<.01)continue;
      const size=Array.from(m.geom_size.slice(id*3,id*3+3)) as number[],type=m.geom_type[id];let geometry:T.BufferGeometry;
      if(type===7){const meshId=m.geom_dataid[id];geometry=meshCache.get(meshId)??meshGeometry(m,meshId);meshCache.set(meshId,geometry);}
      else if(type===6)geometry=new T.BoxGeometry(size[0]*2,size[1]*2,size[2]*2);
      else if(type===5){geometry=new T.CylinderGeometry(size[0],size[0],size[1]*2,24);geometry.rotateX(Math.PI/2);}
      else if(type===3){geometry=new T.CapsuleGeometry(size[0],size[1]*2,6,16);geometry.rotateX(Math.PI/2);}
      else{geometry=new T.SphereGeometry(type===4?1:size[0],24,16);if(type===4)geometry.scale(size[0],size[1],size[2]);}
      const rgba=Array.from(m.geom_rgba.slice(id*4,id*4+4)) as number[];
      const mesh=new T.Mesh(geometry,new T.MeshStandardMaterial({color:new T.Color(rgba[0],rgba[1],rgba[2]),roughness:.65,metalness:.12,side:T.DoubleSide}));
      mesh.matrixAutoUpdate=false;this.robot.add(mesh);this.robotMeshes.push({id,mesh});
    }this.updateRobot();
  }
  updateRobot(){if(!this.engine)return;const d=this.engine.data;for(const {id,mesh} of this.robotMeshes){const i=id*9,j=id*3,r=d.geom_xmat,p=d.geom_xpos;mesh.matrix.set(r[i],r[i+1],r[i+2],p[j],r[i+3],r[i+4],r[i+5],p[j+1],r[i+6],r[i+7],r[i+8],p[j+2],0,0,0,1);mesh.matrixWorldNeedsUpdate=true;}}
  dispose(){cancelAnimationFrame(this.animation);this.observer.disconnect();this.controls.dispose();this.clear(this.robot);this.clear(this.world);this.renderer.dispose();}
}
