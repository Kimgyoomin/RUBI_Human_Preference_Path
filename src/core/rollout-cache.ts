import type { Scenario, RouteKey } from './scenario.ts';
import type { Rollout } from '../runtime/physics.ts';

export const ROLLOUT_CONTRACT = 'rubi-mj3.13-ort1.30-terrain-follower-v2';
export function rolloutKey(hashes: Record<string, string>, profile: unknown, s: Scenario, route: RouteKey): string {
  return JSON.stringify({contract: ROLLOUT_CONTRACT, geometryVersion: s.geometry?.version ?? 'legacy-polyline-v1', hashes: Object.keys(hashes).sort().map(k => [k, hashes[k]]), profile,
    world: {height: s.height, width: s.width, depth: s.depth}, speed: s.speed, route, points: s.routes[route]});
}

/** Successful same-tab records only. Never assume cross-device numeric identity. */
export class RolloutCache {
  private entries = new Map<string, {run: Rollout; bytes: number}>();
  private used = 0;
  private maxBytes: number;
  private maxEntries: number;
  constructor(maxBytes = 24 * 1024 * 1024, maxEntries = 12) {this.maxBytes=maxBytes;this.maxEntries=maxEntries;}
  get size() { return this.entries.size; }
  get bytes() { return this.used; }
  clear() { this.entries.clear(); this.used = 0; }
  get(key: string): Rollout | undefined {
    const value = this.entries.get(key);
    if (!value) return undefined;
    this.entries.delete(key); this.entries.set(key, value);
    return value.run;
  }
  set(key: string, run: Rollout): void {
    if (!run.completed || !run.frames.length) return;
    const bytes = run.frames.reduce((n, f) => n + 128 + f.qpos.length * 16, 1024);
    if (bytes > this.maxBytes) return;
    const old = this.entries.get(key);
    if (old) { this.used -= old.bytes; this.entries.delete(key); }
    while (this.entries.size && (this.used + bytes > this.maxBytes || this.entries.size >= this.maxEntries)) {
      const oldest = this.entries.keys().next().value!;
      this.used -= this.entries.get(oldest)!.bytes; this.entries.delete(oldest);
    }
    this.entries.set(key, {run, bytes}); this.used += bytes;
  }
}
