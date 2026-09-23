import { AppsScriptTransport } from './apps-script.ts';

/** The server gate is authoritative. Editing this UI cannot enable writes. */
export async function allowPublicStart(): Promise<boolean> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}study.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error('설문 설정을 불러오지 못했습니다.');
    const study = await res.json();
    if (study.status === 'draft') return true; // existing pilot, separate dataset
    if (study.status !== 'released' || study.id !== 'rubi-hpp-main-v1' ||
        study.requiredReleaseVersion !== 'isolated-main-collector-v8' || study.datasetTag !== 'main-v1') {
      throw new Error('본 조사 설정을 확인 중입니다. 잠시 후 다시 방문해 주세요.');
    }
    const transport = new AppsScriptTransport(study.responseApi);
    try {
      const reply = await transport.ping(study.id, study.status) as unknown as Record<string, unknown>;
      if (reply.service !== 'rubi-hpp' || reply.experimentId !== study.id || reply.studyStatus !== study.status ||
          reply.releaseVersion !== study.requiredReleaseVersion || reply.datasetTag !== study.datasetTag ||
          reply.schemaReady !== true) throw new Error('본 조사 저장 서비스가 아직 준비되지 않았습니다.');
      if (reply.collectionOpen !== true) throw new Error('지금은 설문을 받지 않고 있습니다. 개시 안내를 받은 뒤 다시 방문해 주세요.');
    } finally { transport.dispose(); }
    return true;
  } catch (error) {
    const root = document.getElementById('app')!;
    root.replaceChildren();
    const panel = document.createElement('main');
    panel.style.cssText = 'font:16px/1.7 system-ui,sans-serif;max-width:620px;margin:12vh auto;padding:24px;';
    const title = document.createElement('h1'); title.textContent = 'RUBI 경로 선택 설문';
    const message = document.createElement('p'); message.setAttribute('role', 'status');
    message.textContent = error instanceof Error ? error.message : '설문 연결을 확인하고 있습니다.';
    const retry = document.createElement('button'); retry.textContent = '다시 확인하기'; retry.onclick = () => location.reload();
    retry.style.cssText = 'font:inherit;padding:10px 18px;cursor:pointer';
    panel.append(title, message, retry); root.append(panel);
    return false;
  }
}
