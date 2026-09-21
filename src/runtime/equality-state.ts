/** @mujoco/mujoco 3.13.0 has an unregistered memory_view<bool> for eq_active.
 * Use the official get/set state API, preserving every other equality flag.
 * No pointer offsets, model edits, or changes to the release timing are used.
 */
export function equalityState(mj: any, model: any, data: any): number[] {
  const spec = mj.mjtState.mjSTATE_EQ_ACTIVE.value;
  const count = mj.mj_stateSize(model, spec);
  const buffer = new mj.DoubleBuffer(new Array(count).fill(0));
  try {
    mj.mj_getState(model, data, buffer, spec);
    return Array.from(buffer.getView() as Float64Array);
  } finally { buffer.delete(); }
}

export function setEqualityActive(mj: any, model: any, data: any, index: number, active: boolean): void {
  const state = equalityState(mj, model, data);
  if (!Number.isInteger(index) || index < 0 || index >= state.length) throw new Error('Invalid equality constraint index');
  state[index] = active ? 1 : 0;
  mj.mj_setState(model, data, state, mj.mjtState.mjSTATE_EQ_ACTIVE.value);
}
