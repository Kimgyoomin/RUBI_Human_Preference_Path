import type { Scenario } from './scenario.ts';

export const UX_PROTOCOL = 'guided-self-paced-v5';
export const UX_LABEL_CONDITION = 'core-view-no-labels-review-with-choice-v2';
export const OBSERVATION_POLICY = 'common-platform-exit-self-confirm-v1';

/** Pilot UI rule, NOT a validated threshold for human comprehension.
 * Both routes must be seen from Start through the same world-X checkpoint:
 * the platform's far edge plus the existing 0.4 m centreline allowance.
 * The rest is optional viewing, but the physical rollout must still succeed.
 */
export function viewingCheckpoint(scene: Pick<Scenario, 'depth'>): number {
  return 3 + scene.depth / 2 + 0.4;
}
export function canFinishViewing(scene: Pick<Scenario, 'depth'>, x: number, shownTime: number,
  visibleWallMs: number, maxGapMs: number): boolean {
  return [x, shownTime, visibleWallMs, maxGapMs].every(Number.isFinite) &&
    x >= viewingCheckpoint(scene) && shownTime > 0 && visibleWallMs > 0 &&
    shownTime / (visibleWallMs / 1000) >= 0.90 && maxGapMs <= 400;
}
export function viewedFraction(shownSeconds: number, duration: number): number {
  if (!Number.isFinite(shownSeconds) || !Number.isFinite(duration) || duration <= 0) return 0;
  return Math.max(0, Math.min(1, shownSeconds / duration));
}

type Store = Pick<Storage, 'setItem'>;
/** Archive first, then replace only this protocol's active session.
 * No global storage.clear(), asset deletion, participant-ID rotation or Sheets write.
 * A failed archive/save must leave the caller's in-memory state unchanged.
 */
export function preserveAndRestart<T extends {id: string; participantId: string; pending?: unknown}>(
  storage: Store, key: string, previous: T, next: T): void {
  if (previous.pending) throw new Error('아직 저장하지 못한 답변이 있습니다. 먼저 저장을 마쳐 주세요.');
  if (!next.id || next.id === previous.id || next.participantId !== previous.participantId) {
    throw new Error('다시 시작할 참여 기록이 올바르지 않습니다.');
  }
  storage.setItem(`${key}:archive:${previous.id}`, JSON.stringify(previous));
  storage.setItem(key, JSON.stringify(next));
}
