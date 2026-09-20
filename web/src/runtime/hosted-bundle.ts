import { sha256 } from '../core/model.ts';

type Asset = { path: string; sha256?: string | null };
type Manifest = { schemaVersion: number; profile: string; files: Asset[] };

function checkedPath(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.\/-]+$/.test(value) || value.startsWith('/') || value.split('/').some(p => p === '..' || p === '.' || !p)) {
    throw new Error('bundle.json에 허용되지 않은 파일 경로가 있습니다.');
  }
  if (!/\.(xml|onnx|stl|obj|png|jpg|jpeg)$/i.test(value)) throw new Error(`지원하지 않는 자산 형식: ${value}`);
  return value;
}

/** Files in this bundle are delivered to the visitor's browser and are downloadable. */
export async function fetchHostedFiles(base: URL): Promise<File[]> {
  const response = await fetch(new URL('bundle.json', base), { signal: AbortSignal.timeout(15000), cache: 'no-cache' });
  if (!response.ok) throw new Error('배포 모델 목록(rubi/bundle.json)을 찾을 수 없습니다. 연구자 모드의 파일 선택으로도 연결할 수 있습니다.');
  const manifest = await response.json() as Manifest;
  if (manifest.schemaVersion !== 1 || manifest.profile !== 'gazebo-terrain-330-32-65-6' || !Array.isArray(manifest.files) || manifest.files.length < 3 || manifest.files.length > 64) {
    throw new Error('RUBI terrain bundle.json 형식이 올바르지 않습니다.');
  }
  const paths = manifest.files.map(a => checkedPath(a.path));
  if (new Set(paths).size !== paths.length || !['rubi.xml', 'encoder.onnx', 'policy.onnx'].every(p => paths.includes(p))) {
    throw new Error('bundle.json에 XML/encoder/policy가 빠졌거나 중복 경로가 있습니다.');
  }
  const results = await Promise.all(manifest.files.map(async asset => {
    try {
      const r = await fetch(new URL(asset.path, base), { signal: AbortSignal.timeout(90000), cache: 'no-cache' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      if ((r.headers.get('Content-Type') || '').includes('text/html')) throw new Error('파일 대신 HTML이 반환되었습니다.');
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (!bytes.length || bytes.length > 64 * 1024 * 1024) throw new Error('비어 있거나 64 MiB를 넘는 파일입니다.');
      if (asset.sha256 && await sha256(bytes) !== asset.sha256.toLowerCase()) throw new Error('SHA256 불일치');
      return { file: new File([bytes], asset.path.split('/').at(-1)!), error: '' };
    } catch (e) {
      return { file: undefined, error: `${asset.path} (${e instanceof Error ? e.message : String(e)})` };
    }
  }));
  const errors = results.filter(r => r.error).map(r => r.error);
  if (errors.length) throw new Error(`배포 자산 연결 실패. web/public/rubi/에 파일을 추가한 뒤 다시 빌드하세요: ${errors.join(', ')}`);
  return results.map(r => r.file!);
}
