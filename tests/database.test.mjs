import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDatabaseSnapshot,
  createDefaultDatabase,
  extractStateFromDatabase,
  normalizeDatabasePayload,
} from '../scripts/database.js';

function createDefaultState() {
  return {
    totalP: 0,
    totalC: 0,
    target: 150,
    calorieTarget: 2200,
    meals: 4,
    streak: 0,
    logItems: [],
    history: [],
    chatState: { currentState: 'root', messages: [] },
    settings: {
      language: 'en',
      defaultScreen: 'home',
      launchIntro: true,
      animations: 'full',
      reminderEnabled: false,
      reminderTime: '19:00',
    },
    dayStamp: '2026-03-25',
    recentFoods: [],
    databaseMeta: {
      schemaVersion: 1,
      savedAt: null,
    },
  };
}

test('normalizeDatabasePayload migrates a legacy state payload', () => {
  const defaultState = createDefaultState();
  const payload = normalizeDatabasePayload({
    ...defaultState,
    logItems: [
      { name: 'Tuna toast', protein: 28, calories: 320 },
    ],
  }, defaultState);

  const hydratedState = extractStateFromDatabase(payload, defaultState);
  assert.equal(payload.schemaVersion, 1);
  assert.equal(hydratedState.recentFoods.length, 1);
  assert.equal(hydratedState.recentFoods[0].name, 'Tuna toast');
});

test('buildDatabaseSnapshot keeps recent foods deduped across repeated saves', () => {
  const defaultState = createDefaultState();
  const state = {
    ...defaultState,
    logItems: [
      { name: 'Greek yogurt', protein: 20, calories: 150 },
    ],
  };

  const firstSnapshot = buildDatabaseSnapshot(state, createDefaultDatabase(defaultState), defaultState);
  const secondSnapshot = buildDatabaseSnapshot(state, firstSnapshot, defaultState);

  assert.equal(firstSnapshot.collections.recentFoods.length, 1);
  assert.equal(secondSnapshot.collections.recentFoods.length, 1);
  assert.equal(secondSnapshot.collections.recentFoods[0].name, 'Greek yogurt');
});

test('buildDatabaseSnapshot tracks stronger save metadata across revisions', () => {
  const defaultState = createDefaultState();
  const firstSnapshot = buildDatabaseSnapshot(defaultState, createDefaultDatabase(defaultState), defaultState);
  const secondSnapshot = buildDatabaseSnapshot({
    ...defaultState,
    logItems: [
      { name: 'Protein shake', protein: 25, calories: 180 },
    ],
  }, firstSnapshot, defaultState);

  assert.equal(firstSnapshot.meta.revision, 1);
  assert.equal(firstSnapshot.meta.saveCount, 1);
  assert.equal(firstSnapshot.meta.lastItemCount, 0);
  assert.equal(secondSnapshot.meta.revision, 2);
  assert.equal(secondSnapshot.meta.saveCount, 2);
  assert.equal(secondSnapshot.meta.lastItemCount, 1);
  assert.equal(secondSnapshot.meta.historyCount, 0);
});

test('history entries keep meal snapshots for journal drilldown', () => {
  const defaultState = createDefaultState();
  const payload = normalizeDatabasePayload({
    ...defaultState,
    history: [
      {
        dayStamp: '2026-03-24',
        totalProtein: 42,
        totalCalories: 510,
        itemCount: 2,
        target: 150,
        calorieTarget: 2200,
        items: [
          { name: 'Greek yogurt', protein: 20, calories: 150 },
          { name: 'Tuna toast', protein: 22, calories: 360 },
        ],
      },
    ],
  }, defaultState);

  const hydratedState = extractStateFromDatabase(payload, defaultState);
  assert.equal(hydratedState.history.length, 1);
  assert.equal(hydratedState.history[0].items.length, 2);
  assert.equal(hydratedState.history[0].items[0].name, 'Greek yogurt');
  assert.equal(hydratedState.history[0].items[1].name, 'Tuna toast');
});
