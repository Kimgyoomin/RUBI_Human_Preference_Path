import { references, sha256 } from '../core/model.ts';
import type { Bundle } from '../core/model.ts';

export type LoadMetrics = { elapsedMs: number; decodedBytes: number; files: number; hashPasses: number };
export function checkedAssetPath(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.\/-]+$/.test(value) || value.startsWith('/') || value.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('허용되지 않은 모델 자산 경로입니다.');
  if (!/\.(xml|onnx|stl|obj|png|jpg|jpeg)$/i.test(value)) throw new Error('지원하지 않는 자산: ' + value);
  return value;
}
export function versionedAssetUrl(base: URL, path: string, hash?: string): URL {
  const url = new URL(checkedAssetPath(path), base);
  if (hash) url.searchParams.set('sha256', hash);
  return url;
}

/** One verified ArrayBuffer per asset; no File -> ArrayBuffer -> second hash roundtrip.
 * A content hash is both the HTTP cache version and the integrity check, not a secret.
 */
export async function fetchHostedBundle(base: URL, progress: (message: string) => void = () => {}): Promise<{bundle: Bundle; metrics: LoadMetrics}> {
  const started = performance.now();
  const response = await fetch(new URL('bundle.json', base), {cache: 'no-cache', signal: AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error(`모델 목록 로드 실패: HTTP ${response.status}`);
  const manifest = await response.json();
  if (manifest.schemaVersion !== 1 || manifest.profile !== 'gazebo-terrain-330-32-65-6' || !Array.isArray(manifest.files) || manifest.files.length < 3 || manifest.files.length > 64) throw new Error('모델 목록 형식이 올바르지 않습니다.');
  const assets: {path: string; sha256?: string}[] = manifest.files.map((a: {path: unknown; sha256?: unknown}) => {
    const path = checkedAssetPath(a.path);
    if (a.sha256 != null && (typeof a.sha256 !== 'string' || !/^[a-fA-F0-9]{64}$/.test(a.sha256))) throw new Error('잘못된 SHA-256: ' + path);
    return {path, sha256: typeof a.sha256 === 'string' ? a.sha256.toLowerCase() : undefined};
  });
  const paths = assets.map(a => a.path);
  if (new Set(paths).size !== paths.length || !['rubi.xml', 'encoder.onnx', 'policy.onnx'].every(p => paths.includes(p))) throw new Error('필수 파일 누락 또는 중복 경로입니다.');
  const buffers = new Map<string, Uint8Array>(), hashes: Record<string, string> = {};
  let next = 0, completed = 0, total = 0, hashPasses = 0;
  // Bound simultaneous allocations on small laptops. All workers settle before an error escapes.
  const worker = async () => {
    while (next < assets.length) {
      const asset = assets[next++], url = versionedAssetUrl(base, asset.path, asset.sha256);
      let bytes: Uint8Array | undefined, digest = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await fetch(url, {cache: attempt ? 'reload' : asset.sha256 ? 'force-cache' : 'no-cache', signal: AbortSignal.timeout(90000)});
        if (!r.ok || (r.headers.get('Content-Type') || '').includes('text/html')) throw new Error(`${asset.path}: HTTP ${r.status} 또는 잘못된 응답 형식`);
        bytes = new Uint8Array(await r.arrayBuffer());
        if (!bytes.length || bytes.length > 64 * 1024 * 1024) throw new Error('자산 크기 제한: ' + asset.path);
        digest = await sha256(bytes); hashPasses++;
        if (!asset.sha256 || digest === asset.sha256) break;
        if (attempt) throw new Error('SHA-256 불일치 (재다운로드 후): ' + asset.path);
      }
      buffers.set(asset.path, bytes!); hashes[asset.path] = digest;
      total += bytes!.length; completed++;
      progress(`모델 로딩 ${completed}/${assets.length} · ${(total / 1048576).toFixed(1)} MiB 확인`);
    }
  };
  const results = await Promise.allSettled(Array.from({length: Math.min(3, assets.length)}, worker));
  const failed = results.find(r => r.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
  const xml = new TextDecoder('utf-8', {fatal: true}).decode(buffers.get('rubi.xml'));
  for (const path of references(xml).files) if (!buffers.has(path)) throw new Error('XML 참조 누락: ' + path);
  buffers.delete('rubi.xml');
  return {bundle: {xml, files: buffers, hashes, name: 'rubi.xml'}, metrics: {elapsedMs: performance.now() - started, decodedBytes: total, files: assets.length, hashPasses}};
}
