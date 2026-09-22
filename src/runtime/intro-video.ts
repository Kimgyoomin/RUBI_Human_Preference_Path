import {validateIntro} from '../core/binary-study.ts';
import type {IntroManifest} from '../core/binary-study.ts';

/** Self-confirmed familiarization, not a claim of measured attention or 100% viewing. */
export class IntroVideo{
  manifest:IntroManifest|undefined;started=false;
  private video:HTMLVideoElement;private acknowledged:HTMLInputElement;private next:HTMLButtonElement;private status:HTMLElement;private loadToken=0;
  constructor(privateRoot:HTMLElement){
    this.video=privateRoot.querySelector<HTMLVideoElement>('#g-intro-video')!;
    this.acknowledged=privateRoot.querySelector<HTMLInputElement>('#g-intro-ack')!;
    this.next=privateRoot.querySelector<HTMLButtonElement>('#g-begin')!;
    this.status=privateRoot.querySelector<HTMLElement>('#g-intro-status')!;
    this.video.addEventListener('playing',()=>{this.started=true;this.acknowledged.disabled=false;this.status.textContent='평지 걷기, 네 높이의 턱 통과, 돌아가는 모습을 차례로 보여드립니다.';this.update();});
    this.video.addEventListener('error',()=>{this.started=false;this.acknowledged.disabled=true;this.next.disabled=true;this.status.textContent='소개 영상을 재생하지 못했습니다. 아래에서 다시 불러와 주세요.';});
    this.video.addEventListener('ratechange',()=>{if(this.video.playbackRate!==1)this.video.playbackRate=1;});
    this.acknowledged.addEventListener('change',()=>this.update());
  }
  get ready(){return Boolean(this.manifest&&this.started&&this.acknowledged.checked);}
  private update(){this.next.disabled=!this.ready;}
  pause(){this.video.pause();}
  reset(){this.pause();this.started=false;this.acknowledged.checked=false;this.acknowledged.disabled=true;this.update();}
  async load(url:URL):Promise<void>{
    const token=++this.loadToken;this.reset();this.manifest=undefined;
    this.status.textContent='같은 로봇과 제어기로 만든 소개 영상을 불러오고 있어요.';
    const r=await fetch(url,{cache:'no-cache',signal:AbortSignal.timeout(20000)});
    if(!r.ok)throw new Error('소개 영상이 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.');
    const m=validateIntro(await r.json());if(token!==this.loadToken)return;
    this.manifest=m;
    const media=new URL(m.video,url);media.searchParams.set('v',m.videoSha256.slice(0,16));
    this.video.src=media.href;this.video.poster=new URL(m.poster,url).href;this.video.playbackRate=1;this.video.load();
    const chapters=document.querySelector<HTMLElement>('#g-intro-chapters')!;chapters.replaceChildren();
    for(const e of m.episodes){
      const button=document.createElement('button');button.type='button';button.className='g-secondary';button.textContent=e.title;
      button.onclick=()=>{if(this.video.readyState>=1)this.video.currentTime=e.startSeconds;void this.video.play().catch(()=>{this.status.textContent='영상의 재생 버튼을 눌러 주세요.';});};chapters.appendChild(button);
    }
    this.status.textContent=`약 ${Math.round(m.durationSeconds)}초 · 실제 촬영이 아닌 시뮬레이션 예시입니다. 필요한 구간은 다시 볼 수 있어요.`;
    this.update();
  }
}
