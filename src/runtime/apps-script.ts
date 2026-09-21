export type AppsScriptReply = {
  source: 'rubi-hpp-apps-script';
  requestId: string;
  ok: boolean;
  kind?: string;
  submissionId?: string;
  duplicate?: boolean;
  service?: string;
  experimentId?: string;
  studyStatus?: string;
  message?: string;
};

export function appsScriptEndpoint(value:string): string {
  if(!value.trim()) throw new Error('Apps Script Web App 주소를 입력하세요.');
  const url=new URL(value);
  if(url.protocol!=='https:' || url.hostname!=='script.google.com' || !/^\/macros\/s\/[^/]+\/exec$/.test(url.pathname)) {
    throw new Error('배포된 Google Apps Script Web App의 /exec 주소를 입력하세요.');
  }
  return url.href;
}

/** Cross-origin Apps Script transport without no-cors.
 * The Web App returns a tiny HtmlService page in a hidden iframe and confirms
 * persistence through window.postMessage. Never treats a fire-and-forget POST
 * as a successful research save. */
export class AppsScriptTransport {
  endpoint:string;
  private frame:HTMLIFrameElement;
  constructor(endpoint:string) {
    this.endpoint=appsScriptEndpoint(endpoint);
    this.frame=document.createElement('iframe');
    this.frame.name='rubi-hpp-collector-'+crypto.randomUUID();
    this.frame.hidden=true;
    this.frame.setAttribute('aria-hidden','true');
    document.body.appendChild(this.frame);
  }
  dispose(){this.frame.remove();}
  async request(kind:'ping'|'trial'|'profile',payload:Record<string,unknown>,timeoutMs=15000):Promise<AppsScriptReply> {
    const requestId=crypto.randomUUID();
    return new Promise<AppsScriptReply>((resolve,reject)=>{
      const form=document.createElement('form');
      form.method='POST';form.action=this.endpoint;form.target=this.frame.name;form.hidden=true;
      const field=document.createElement('input');field.type='hidden';field.name='payload';
      field.value=JSON.stringify({kind,requestId,payload});form.appendChild(field);document.body.appendChild(form);
      const cleanup=()=>{clearTimeout(timer);window.removeEventListener('message',onMessage);form.remove();};
      const onMessage=(event:MessageEvent)=>{
        if(event.source!==this.frame.contentWindow)return;
        const data=event.data as AppsScriptReply|undefined;
        if(!data||data.source!=='rubi-hpp-apps-script'||data.requestId!==requestId)return;
        cleanup();
        if(!data.ok) reject(new Error(data.message||'Google Sheets 저장이 확인되지 않았습니다.'));
        else resolve(data);
      };
      window.addEventListener('message',onMessage);
      const timer=window.setTimeout(()=>{cleanup();reject(new Error('Google Sheets 저장 확인 시간이 초과되었습니다. 같은 응답을 다시 시도할 수 있습니다.'));},timeoutMs);
      try{form.submit();}catch(e){cleanup();reject(e);}
    });
  }
  async ping(experimentId:string,studyStatus:string){
    return this.request('ping',{experimentId,studyStatus},10000);
  }
}
