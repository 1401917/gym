import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDatabaseSnapshot,
  createDefaultDatabase,
  extractStateFromDatabase,
  mergeRecentFoods,
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
  assert.equal(hydratedState.recentFoods[0].usageCount, 1);
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
  assert.equal(secondSnapshot.collections.recentFoods[0].usageCount, 1);
});

test('buildDatabaseSnapshot prioritizes frequently reused foods before one-off foods', () => {
  const defaultState = createDefaultState();
  let previousSnapshot = createDefaultDatabase(defaultState);

  const snapshots = [
    [{ name: 'Chicken breast', protein: 45, calories: 300 }],
    [
      { name: 'Chicken breast', protein: 45, calories: 300 },
      { name: 'Apple', protein: 0, calories: 95 },
    ],
    [
      { name: 'Chicken breast', protein: 45, calories: 300 },
      { name: 'Apple', protein: 0, calories: 95 },
      { name: 'Cottage cheese', protein: 15, calories: 120 },
    ],
    [
      { name: 'Chicken breast', protein: 45, calories: 300 },
      { name: 'Apple', protein: 0, calories: 95 },
      { name: 'Cottage cheese', protein: 15, calories: 120 },
      { name: 'Chicken breast', protein: 45, calories: 300 },
    ],
  ];

  for (const logItems of snapshots) {
    previousSnapshot = buildDatabaseSnapshot({
      ...defaultState,
      logItems,
    }, previousSnapshot, defaultState);
  }

  const recentFoods = previousSnapshot.collections.recentFoods;
  assert.equal(recentFoods[0].name, 'Chicken breast');
  assert.equal(recentFoods[0].usageCount, 2);
  assert.equal(recentFoods[1].name, 'Cottage cheese');
  assert.equal(recentFoods[1].usageCount, 1);
  assert.equal(recentFoods[2].name, 'Apple');
  assert.equal(recentFoods[2].usageCount, 1);
});

test('mergeRecentFoods keeps more saved foods than the old small list limit', () => {
  const foods = Array.from({ length: 40 }, (_, index) => ({
    name: `Food ${index + 1}`,
    protein: index,
    calories: 100 + index,
    lastUsedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
  }));

  const recentFoods = mergeRecentFoods([], foods);

  assert.equal(recentFoods.length, 40);
  assert.equal(recentFoods[0].name, 'Food 40');
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
