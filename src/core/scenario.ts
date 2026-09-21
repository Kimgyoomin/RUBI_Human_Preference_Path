import { clamp } from './terrain-controller.ts';

export type Point = [number, number];
export type RouteKey = 'direct' | 'detour';
export const ROUTE_GEOMETRY_VERSION = 'cosine-bypass-v2';
const CHORD = 6;
const SAMPLES = 480;
const REQUIRED_CLEARANCE = 0.4;
const UNIT_CURVE = Array.from({length: SAMPLES + 1}, (_, i) =>
  i === 0 || i === SAMPLES ? 0 : 0.5 * (1 - Math.cos(2 * Math.PI * i / SAMPLES)));

export type RouteMetrics = {
  plannedLengthM: number;
  startHeadingRad: number;
  endHeadingRad: number;
  maxCurvaturePerM: number;
  integratedAbsCurvatureRad: number;
};
export type Scenario = {
  id: string; height: number; detour: number; width: number; depth: number; speed: number;
  routes: Record<RouteKey, Point[]>;
  geometry: {
    version: string; family: 'raised-cosine'; amplitudeM: number; segments: number;
    lengthErrorM: number; minCenterlineClearanceM: number; requiredCenterlineClearanceM: number;
    // Analytic curve metrics, not a claim about the robot's measured yaw/clearance.
    analyticEndpointHeadingRad: [number, number]; analyticMaxCurvaturePerM: number;
    analyticIntegratedAbsCurvatureRad: number; metrics: Record<RouteKey, RouteMetrics>;
  };
};

export function length(points: Point[]): number {
  return points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0]-points[i][0], p[1]-points[i][1]), 0);
}
export function turnAngles(points: Point[]): number[] {
  return points.slice(1, -1).map((p, i) => {
    const a = Math.atan2(p[1]-points[i][1], p[0]-points[i][0]);
    const b = Math.atan2(points[i+2][1]-p[1], points[i+2][0]-p[0]);
    return Math.abs(Math.atan2(Math.sin(b-a), Math.cos(b-a)));
  });
}
function routeMetrics(points: Point[]): RouteMetrics {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p[0]-points[i][0], p[1]-points[i][1]));
  const turns = turnAngles(points), last = points.length-1;
  return {
    plannedLengthM: length(points),
    startHeadingRad: Math.atan2(points[1][1]-points[0][1], points[1][0]-points[0][0]),
    endHeadingRad: Math.atan2(points[last][1]-points[last-1][1], points[last][0]-points[last-1][0]),
    maxCurvaturePerM: turns.reduce((max, a, i) => Math.max(max, a / ((lengths[i]+lengths[i+1])/2)), 0),
    integratedAbsCurvatureRad: turns.reduce((sum, a) => sum+a, 0),
  };
}

function amplitudeLength(amplitude: number): number {
  let sum = 0;
  for (let i=1; i<=SAMPLES; i++) sum += Math.hypot(CHORD/SAMPLES, amplitude*(UNIT_CURVE[i]-UNIT_CURVE[i-1]));
  return sum;
}
function smoothBypass(detour: number): {points: Point[]; amplitude: number} {
  const target = CHORD + detour;
  let lo = 0, hi = 1;
  while (amplitudeLength(hi) < target) hi *= 2;
  // Monotone arc length: solve the actual displayed/followed polyline, not a proxy.
  for (let i=0; i<48; i++) {
    const mid = (lo+hi)/2;
    if (amplitudeLength(mid) < target) lo=mid; else hi=mid;
  }
  const amplitude = (lo+hi)/2;
  return {amplitude, points: UNIT_CURVE.map((u, i) => [CHORD*i/SAMPLES, amplitude*u])};
}

function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx=b[0]-a[0], dy=b[1]-a[1], l2=dx*dx+dy*dy;
  const t=l2 ? clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l2, 0, 1) : 0;
  return Math.hypot(p[0]-a[0]-t*dx, p[1]-a[1]-t*dy);
}
function intersects(a: Point, b: Point, c: Point, d: Point): boolean {
  const cross=(p: Point, q: Point, r: Point) => (q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
  if (Math.max(a[0],b[0])<Math.min(c[0],d[0]) || Math.max(c[0],d[0])<Math.min(a[0],b[0]) ||
      Math.max(a[1],b[1])<Math.min(c[1],d[1]) || Math.max(c[1],d[1])<Math.min(a[1],b[1])) return false;
  return cross(a,b,c)*cross(a,b,d)<=0 && cross(c,d,a)*cross(c,d,b)<=0;
}
/** Exact distance from all polyline segments to the platform's closed XY rectangle.
 * A centerline guard only; not certification of full-body/foot collision clearance. */
export function platformClearance(points: Point[], width=0.7, depth=0.8): number {
  if (points.length<2 || !(width>0) || !(depth>0) || !Number.isFinite(width+depth) ||
      !points.every(p=>p.length===2 && p.every(Number.isFinite))) throw new Error('유효한 경로와 플랫폼 크기가 필요합니다.');
  const xmin=CHORD/2-depth/2, xmax=CHORD/2+depth/2, ymin=-width/2, ymax=width/2;
  const corners: Point[]=[[xmin,ymin],[xmax,ymin],[xmax,ymax],[xmin,ymax]];
  const inside=(p: Point)=>p[0]>=xmin && p[0]<=xmax && p[1]>=ymin && p[1]<=ymax;
  let best=Infinity;
  for (let i=1; i<points.length; i++) {
    const a=points[i-1], b=points[i];
    if (inside(a)||inside(b)) return 0;
    for (let j=0;j<4;j++) {
      const c=corners[j], d=corners[(j+1)%4];
      if (intersects(a,b,c,d)) return 0;
      best=Math.min(best,pointSegmentDistance(a,c,d),pointSegmentDistance(b,c,d),pointSegmentDistance(c,a,b),pointSegmentDistance(d,a,b));
    }
  }
  return best;
}

/** Uniform arc-distance samples for display markers. Never create a marker at
 * every dense control point: that would undo the WebGL loading optimization. */
export function sampleRoute(points: Point[], spacing=0.12): Point[] {
  if (points.length<2 || !points.every(p=>p.length===2 && p.every(Number.isFinite)) ||
      !Number.isFinite(spacing) || spacing<=0) throw new Error('경로 표식 간격을 확인하세요.');
  const total=length(points);
  if (total/spacing>10000) throw new Error('경로 표식이 너무 많습니다.');
  const result: Point[]=[[...points[0]]];
  let target=spacing, covered=0;
  for (let i=1;i<points.length;i++) {
    const a=points[i-1],b=points[i],l=Math.hypot(b[0]-a[0],b[1]-a[1]);
    if (l===0) continue;
    while (target<total-1e-9 && target<=covered+l) {
      const t=(target-covered)/l;
      result.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]); target+=spacing;
    }
    covered+=l;
  }
  if (total>0) result.push([...points[points.length-1]]);
  return result;
}

export function makeScenario(height=0.05, detour=0.8, speed=0.3): Scenario {
  if (![height,detour,speed].every(Number.isFinite) || height<0 || height>0.12 || detour<0.4 || detour>2.4 || speed<0.1 || speed>0.5) throw new Error('장면 설정 범위를 확인하세요.');
  const width=0.7,depth=0.8,{points,amplitude}=smoothBypass(detour);
  const clearance=platformClearance(points,width,depth);
  if (clearance<REQUIRED_CLEARANCE) throw new Error('우회 경로의 로봇 여유 공간이 부족합니다.');
  const routes: Record<RouteKey,Point[]>={direct:[[0,0],[CHORD,0]],detour:points};
  const lengthErrorM=length(points)-(CHORD+detour);
  if (Math.abs(lengthErrorM)>1e-6) throw new Error('추가 우회거리 계산이 허용 오차를 넘었습니다.');
  return {
    id:`platform-${ROUTE_GEOMETRY_VERSION}-h${Math.round(height*1000)}-d${Math.round(detour*1000)}-v${Math.round(speed*1000)}`,
    height,detour,width,depth,speed,routes,
    geometry: {
      version:ROUTE_GEOMETRY_VERSION,family:'raised-cosine',amplitudeM:amplitude,segments:SAMPLES,
      lengthErrorM,minCenterlineClearanceM:clearance,requiredCenterlineClearanceM:REQUIRED_CLEARANCE,
      analyticEndpointHeadingRad:[0,0],analyticMaxCurvaturePerM:2*Math.PI**2*amplitude/CHORD**2,
      analyticIntegratedAbsCurvatureRad:4*Math.atan(amplitude*Math.PI/CHORD),
      metrics:{direct:routeMetrics(routes.direct),detour:routeMetrics(points)},
    },
  };
}

export class Follower {
  progress=0;
  route: Point[]; speed: number;
  private segments: {a:Point;b:Point;dx:number;dy:number;l:number;start:number}[]=[];
  private total=0;
  constructor(route: Point[],speed: number) {
    this.route=route; this.speed=speed;
    for(let i=1;i<route.length;i++) {
      const a=route[i-1],b=route[i],dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy);
      if(l>0) {this.segments.push({a,b,dx,dy,l,start:this.total});this.total+=l;}
    }
    if(!this.segments.length) throw new Error('추종할 경로가 비어 있습니다.');
  }
  command(pos: Point,yaw: number): { velocity:number[]; done:boolean; error:number } {
    let distance2=Infinity,nearest=this.progress;
    // Same nearest-projection/lookahead law as v1; cache segment lengths once.
    for(const {a,dx,dy,l,start} of this.segments) {
      const t=clamp(((pos[0]-a[0])*dx+(pos[1]-a[1])*dy)/(l*l),0,1);
      const d2=(pos[0]-a[0]-t*dx)**2+(pos[1]-a[1]-t*dy)**2;
      if(d2<distance2) {distance2=d2;nearest=start+t*l;}
    }
    const distance=Math.sqrt(distance2);
    this.progress=Math.max(this.progress,nearest);
    const goal=this.route.at(-1)!,remaining=Math.hypot(goal[0]-pos[0],goal[1]-pos[1]);
    if(remaining<0.14) return {velocity:[0,0,0],done:true,error:distance};
    const targetDistance=Math.min(this.total,this.progress+0.45);
    let lo=0,hi=this.segments.length-1;
    while(lo<hi) {const mid=Math.floor((lo+hi)/2),s=this.segments[mid];if(s.start+s.l<targetDistance)lo=mid+1;else hi=mid;}
    const s=this.segments[lo],t=clamp((targetDistance-s.start)/s.l,0,1);
    const target:Point=[s.a[0]+s.dx*t,s.a[1]+s.dy*t];
    const angle=Math.atan2(target[1]-pos[1],target[0]-pos[0])-yaw;
    const err=Math.atan2(Math.sin(angle),Math.cos(angle));
    return {velocity:[this.speed*Math.max(0.1,Math.cos(err))*Math.min(1,remaining/0.5),0,clamp(2*err,-0.8,0.8)],done:false,error:distance};
  }
}
