import { saveState } from './storage.js';

export function createStateStore(initialState) {
  let state = initialState;

  function getState() {
    return state;
  }

  function setState(updater) {
    state = typeof updater === 'function' ? updater(state) : updater;
    saveState(state);
    return state;
  }

  return {
    getState,
    setState
  };
}