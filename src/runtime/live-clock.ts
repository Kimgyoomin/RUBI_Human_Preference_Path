/** Presentation time only. Physics dt/decimation never depend on display FPS.
 * Hidden tabs pause before subsequent physics frames; we do not catch up an
 * unseen interval or mark it as watched. */
export class LiveClock {
  private start=0;private pausedAt=0;private pausedMs=0;private lastShown=0;
  maxGapMs=0;
  private visibility=()=>{
    const now=performance.now();
    if(document.hidden&&!this.pausedAt)this.pausedAt=now;
    else if(!document.hidden&&this.pausedAt){this.pausedMs+=now-this.pausedAt;this.pausedAt=0;this.lastShown=0;}
  };
  constructor(){document.addEventListener('visibilitychange',this.visibility);}
  get visibleWallMs(){return this.start?Math.max(0,performance.now()-this.start-this.pausedMs-(this.pausedAt?performance.now()-this.pausedAt:0)):0;}
  async frame(simulationTime:number,signal:AbortSignal){
    if(!this.start){this.start=performance.now();this.visibility();}
    while(document.hidden||this.visibleWallMs<simulationTime*1000){
      if(signal.aborted)throw new DOMException('보행 관찰을 중지했습니다.','AbortError');
      await new Promise<void>(resolve=>setTimeout(resolve,document.hidden?100:Math.min(16,Math.max(1,simulationTime*1000-this.visibleWallMs))));
    }
    if(signal.aborted)throw new DOMException('보행 관찰을 중지했습니다.','AbortError');
    const now=performance.now();if(this.lastShown)this.maxGapMs=Math.max(this.maxGapMs,now-this.lastShown);this.lastShown=now;
  }
  dispose(){document.removeEventListener('visibilitychange',this.visibility);}
}
