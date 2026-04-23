import test from 'node:test';
import assert from 'node:assert/strict';

function createMemoryLocalStorage() {
  const store = new Map();

  return {
    getItem(key) {
      return store.has(String(key)) ? store.get(String(key)) : null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    removeItem(key) {
      store.delete(String(key));
    },
    clear() {
      store.clear();
    },
  };
}

async function importFreshStorageModule(cacheBust) {
  const moduleUrl = new URL(`../scripts/storage.js?${cacheBust}`, import.meta.url);
  return import(moduleUrl.href);
}

function copyDatabaseBundle(localStorage, fromBaseKey, toBaseKey) {
  for (const suffix of ['', '-hmac', '-metadata']) {
    const value = localStorage.getItem(`${fromBaseKey}${suffix}`);
    if (value) {
      localStorage.setItem(`${toBaseKey}${suffix}`, value);
    } else {
      localStorage.removeItem(`${toBaseKey}${suffix}`);
    }
  }
}

test('saveState and loadState work without triggering a security prompt', async () => {
  const previousLocalStorage = globalThis.localStorage;
  const previousPrompt = globalThis.prompt;

  try {
    globalThis.localStorage = createMemoryLocalStorage();

    let promptCalls = 0;
    globalThis.prompt = () => {
      promptCalls += 1;
      throw new Error('prompt should not be called');
    };

    const saveModule = await importFreshStorageModule(`save-${Date.now()}`);
    const state = saveModule.createDefaultState();
    state.logItems = [
      { name: 'Greek yogurt', protein: 20, calories: 150 },
    ];
    state.totalP = 20;
    state.totalC = 150;

    await saveModule.saveState(state);

    const loadModule = await importFreshStorageModule(`load-${Date.now()}`);
    const loaded = await loadModule.loadState();

    assert.equal(promptCalls, 0);
    assert.equal(loaded.totalP, 20);
    assert.equal(loaded.totalC, 150);
    assert.equal(loaded.logItems.length, 1);
    assert.ok(globalThis.localStorage.getItem('protein-flow-state-v2-device-secret'));
  } finally {
    if (typeof previousLocalStorage === 'undefined') {
      delete globalThis.localStorage;
    } else {
      globalThis.localStorage = previousLocalStorage;
    }

    if (typeof previousPrompt === 'undefined') {
      delete globalThis.prompt;
    } else {
      globalThis.prompt = previousPrompt;
    }
  }
});

test('loadState recovers from the backup database copy when the primary one is corrupted', async () => {
  const previousLocalStorage = globalThis.localStorage;
  const previousPrompt = globalThis.prompt;

  try {
    globalThis.localStorage = createMemoryLocalStorage();
    globalThis.prompt = () => {
      throw new Error('prompt should not be called');
    };

    const saveModule = await importFreshStorageModule(`backup-save-${Date.now()}`);
    const firstState = saveModule.createDefaultState();
    firstState.logItems = [
      { name: 'Greek yogurt', protein: 20, calories: 150 },
    ];
    firstState.totalP = 20;
    firstState.totalC = 150;
    await saveModule.saveState(firstState);

    const secondState = saveModule.createDefaultState();
    secondState.logItems = [
      { name: 'Tuna toast', protein: 28, calories: 320 },
    ];
    secondState.totalP = 28;
    secondState.totalC = 320;
    await saveModule.saveState(secondState);

    assert.ok(globalThis.localStorage.getItem('protein-flow-state-v2-backup'));

    globalThis.localStorage.setItem('protein-flow-state-v2', 'corrupted-payload');
    globalThis.localStorage.setItem('protein-flow-state-v2-hmac', 'corrupted-hmac');

    const loadModule = await importFreshStorageModule(`backup-load-${Date.now()}`);
    const loaded = await loadModule.loadState();

    assert.equal(loaded.totalP, 20);
    assert.equal(loaded.totalC, 150);
    assert.equal(loaded.logItems[0].name, 'Greek yogurt');
    assert.equal(
      globalThis.localStorage.getItem('protein-flow-state-v2'),
      globalThis.localStorage.getItem('protein-flow-state-v2-backup')
    );
  } finally {
    if (typeof previousLocalStorage === 'undefined') {
      delete globalThis.localStorage;
    } else {
      globalThis.localStorage = previousLocalStorage;
    }

    if (typeof previousPrompt === 'undefined') {
      delete globalThis.prompt;
    } else {
      globalThis.prompt = previousPrompt;
    }
  }
});

test('loadState promotes the staged database copy when a save was interrupted', async () => {
  const previousLocalStorage = globalThis.localStorage;
  const previousPrompt = globalThis.prompt;

  try {
    globalThis.localStorage = createMemoryLocalStorage();
    globalThis.prompt = () => {
      throw new Error('prompt should not be called');
    };

    const saveModule = await importFreshStorageModule(`staging-save-${Date.now()}`);
    const state = saveModule.createDefaultState();
    state.logItems = [
      { name: 'Protein shake', protein: 25, calories: 180 },
    ];
    state.totalP = 25;
    state.totalC = 180;
    await saveModule.saveState(state);

    copyDatabaseBundle(globalThis.localStorage, 'protein-flow-state-v2', 'protein-flow-state-v2-staging');
    globalThis.localStorage.setItem('protein-flow-state-v2', 'broken-primary');
    globalThis.localStorage.setItem('protein-flow-state-v2-hmac', 'broken-primary-hmac');

    const loadModule = await importFreshStorageModule(`staging-load-${Date.now()}`);
    const loaded = await loadModule.loadState();

    assert.equal(loaded.totalP, 25);
    assert.equal(loaded.totalC, 180);
    assert.equal(loaded.logItems[0].name, 'Protein shake');
    assert.equal(globalThis.localStorage.getItem('protein-flow-state-v2-staging'), null);
  } finally {
    if (typeof previousLocalStorage === 'undefined') {
      delete globalThis.localStorage;
    } else {
      globalThis.localStorage = previousLocalStorage;
    }

    if (typeof previousPrompt === 'undefined') {
      delete globalThis.prompt;
    } else {
      globalThis.prompt = previousPrompt;
    }
  }
});
