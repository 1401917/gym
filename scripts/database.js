import { sanitizeSettings } from './validation.js';
import { sanitizeAccessState } from './access.js';

export const DATABASE_SCHEMA_VERSION = 1;
const MAX_RECENT_FOODS = 16;

function normalizeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeCount(value, fallback = 0) {
  const numeric = Math.floor(Number(value));
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

function normalizeTimestamp(value, fallback = new Date().toISOString()) {
  const timestamp = new Date(value || '');
  return Number.isNaN(timestamp.getTime()) ? fallback : timestamp.toISOString();
}

function normalizeRecentFoodEntry(entry, fallbackTimestamp) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const normalizedName = String(entry.name || '').trim();
  const normalizedNameKey = typeof entry.nameKey === 'string' ? entry.nameKey : '';
  if (!normalizedName && !normalizedNameKey) {
    return null;
  }

  return {
    name: normalizedName,
    nameKey: normalizedNameKey,
    protein: Math.max(0, normalizeNumber(entry.protein)),
    calories: Math.max(0, normalizeNumber(entry.calories)),
    lastUsedAt: normalizeTimestamp(entry.lastUsedAt, fallbackTimestamp),
  };
}

function buildFoodKey(item) {
  const name = String(item.name || '').trim().toLowerCase();
  const nameKey = typeof item.nameKey === 'string' ? item.nameKey.trim() : '';
  return `${nameKey}::${name}::${normalizeNumber(item.protein)}::${normalizeNumber(item.calories)}`;
}

function buildItemCounter(items = []) {
  const counter = new Map();

  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const key = buildFoodKey(item);
    const current = counter.get(key) || { count: 0, item };
    counter.set(key, {
      count: current.count + 1,
      item,
    });
  }

  return counter;
}

function extractRecentFoodUpdates(previousLogItems = [], currentLogItems = [], savedAt) {
  const previousCounter = buildItemCounter(previousLogItems);
  const currentCounter = buildItemCounter(currentLogItems);
  const updates = [];

  for (const [key, entry] of currentCounter.entries()) {
    const previousCount = previousCounter.get(key)?.count || 0;
    if (entry.count <= previousCount) {
      continue;
    }

    updates.push({
      ...entry.item,
      lastUsedAt: savedAt,
    });
  }

  return updates;
}

export function mergeRecentFoods(existingEntries = [], newEntries = []) {
  const fallbackTimestamp = new Date().toISOString();
  const recentFoods = new Map();

  for (const entry of [...existingEntries, ...newEntries]) {
    const normalizedEntry = normalizeRecentFoodEntry(entry, fallbackTimestamp);
    if (!normalizedEntry) {
      continue;
    }

    recentFoods.set(buildFoodKey(normalizedEntry), normalizedEntry);
  }

  return [...recentFoods.values()]
    .sort((left, right) => new Date(right.lastUsedAt) - new Date(left.lastUsedAt))
    .slice(0, MAX_RECENT_FOODS);
}

function normalizeChatState(chatState, defaultChatState) {
  if (!chatState || !Array.isArray(chatState.messages)) {
    return defaultChatState;
  }

  return {
    currentState: typeof chatState.currentState === 'string' ? chatState.currentState : 'root',
    messages: chatState.messages
      .filter((item) => item && typeof item.text === 'string' && typeof item.role === 'string')
      .map((item) => ({
        role: item.role === 'user' ? 'user' : 'assistant',
        text: String(item.text || ''),
      }))
      .slice(-30),
  };
}

function normalizeLogItems(logItems = []) {
  return (Array.isArray(logItems) ? logItems : [])
    .filter((item) => item && typeof item === 'object' && (item.name || item.nameKey))
    .map((item) => ({
      name: String(item.name || '').trim(),
      nameKey: typeof item.nameKey === 'string' ? item.nameKey : '',
      protein: Math.max(0, normalizeNumber(item.protein)),
      calories: Math.max(0, normalizeNumber(item.calories)),
    }));
}

function normalizeHistory(history = []) {
  return (Array.isArray(history) ? history : [])
    .filter((item) => item && item.dayStamp)
    .map((item) => {
      const items = normalizeLogItems(item.items);

      return {
        dayStamp: String(item.dayStamp),
        totalProtein: Math.max(0, normalizeNumber(item.totalProtein)),
        totalCalories: Math.max(0, normalizeNumber(item.totalCalories)),
        itemCount: Math.max(0, normalizeNumber(item.itemCount || items.length)),
        target: Math.max(0, normalizeNumber(item.target)),
        calorieTarget: Math.max(0, normalizeNumber(item.calorieTarget)),
        items,
      };
    });
}

function stripDerivedState(state) {
  const { recentFoods, databaseMeta, ...persistedState } = state || {};
  return persistedState;
}

function normalizeDatabaseMeta(meta = {}, normalizedState = null) {
  const safeMeta = meta && typeof meta === 'object' ? meta : {};
  const fallbackDayStamp = typeof normalizedState?.dayStamp === 'string' ? normalizedState.dayStamp : '';
  const fallbackItemCount = Array.isArray(normalizedState?.logItems) ? normalizedState.logItems.length : 0;
  const fallbackHistoryCount = Array.isArray(normalizedState?.history) ? normalizedState.history.length : 0;

  return {
    revision: normalizeCount(safeMeta.revision, 0),
    saveCount: normalizeCount(safeMeta.saveCount, 0),
    lastDayStamp: String(safeMeta.lastDayStamp || fallbackDayStamp),
    lastItemCount: normalizeCount(safeMeta.lastItemCount, fallbackItemCount),
    historyCount: normalizeCount(safeMeta.historyCount, fallbackHistoryCount),
  };
}

function normalizeStateRecord(rawState = {}, defaultState) {
  const safeRawState = rawState && typeof rawState === 'object' ? rawState : {};

  return {
    ...defaultState,
    ...safeRawState,
    settings: sanitizeSettings({
      ...defaultState.settings,
      ...(safeRawState.settings || {}),
    }),
    logItems: normalizeLogItems(safeRawState.logItems),
    history: normalizeHistory(safeRawState.history),
    chatState: normalizeChatState(safeRawState.chatState, defaultState.chatState),
    access: sanitizeAccessState({
      ...(defaultState.access || {}),
      ...(safeRawState.access || {}),
    }),
  };
}

export function createDefaultDatabase(defaultState) {
  const normalizedState = normalizeStateRecord(defaultState, defaultState);

  return {
    schemaVersion: DATABASE_SCHEMA_VERSION,
    savedAt: null,
    collections: {
      recentFoods: [],
    },
    meta: normalizeDatabaseMeta({}, normalizedState),
    state: stripDerivedState(normalizedState),
  };
}

export function isDatabasePayload(payload) {
  return Boolean(
    payload
    && typeof payload === 'object'
    && !Array.isArray(payload)
    && Number(payload.schemaVersion || 0) >= DATABASE_SCHEMA_VERSION
    && payload.state
    && typeof payload.state === 'object'
  );
}

export function buildDatabaseSnapshot(state, previousDatabase, defaultState) {
  const savedAt = new Date().toISOString();
  const previousState = normalizeStateRecord(previousDatabase?.state || {}, defaultState);
  const normalizedState = normalizeStateRecord(state, defaultState);
  const previousMeta = normalizeDatabaseMeta(previousDatabase?.meta || {}, previousState);
  const recentFoodUpdates = extractRecentFoodUpdates(previousState.logItems, normalizedState.logItems, savedAt);

  return {
    schemaVersion: DATABASE_SCHEMA_VERSION,
    savedAt,
    collections: {
      recentFoods: mergeRecentFoods(previousDatabase?.collections?.recentFoods || [], recentFoodUpdates),
    },
    meta: {
      revision: previousMeta.revision + 1,
      saveCount: previousMeta.saveCount + 1,
      lastDayStamp: normalizedState.dayStamp || '',
      lastItemCount: normalizedState.logItems.length,
      historyCount: normalizedState.history.length,
    },
    state: stripDerivedState(normalizedState),
  };
}

export function normalizeDatabasePayload(payload, defaultState) {
  if (!isDatabasePayload(payload)) {
    const normalizedState = normalizeStateRecord(payload, defaultState);
    return {
      ...createDefaultDatabase(defaultState),
      savedAt: new Date().toISOString(),
      collections: {
        recentFoods: mergeRecentFoods([], normalizedState.logItems),
      },
      meta: normalizeDatabaseMeta({}, normalizedState),
      state: stripDerivedState(normalizedState),
    };
  }

  const normalizedState = normalizeStateRecord(payload.state, defaultState);
  return {
    schemaVersion: DATABASE_SCHEMA_VERSION,
    savedAt: payload.savedAt || null,
    collections: {
      recentFoods: mergeRecentFoods(payload.collections?.recentFoods || [], normalizedState.logItems),
    },
    meta: normalizeDatabaseMeta(payload.meta || {}, normalizedState),
    state: stripDerivedState(normalizedState),
  };
}

export function extractStateFromDatabase(database, defaultState) {
  const normalizedDatabase = normalizeDatabasePayload(database, defaultState);
  const normalizedState = normalizeStateRecord(normalizedDatabase.state, defaultState);

  return {
    ...normalizedState,
    recentFoods: normalizedDatabase.collections.recentFoods,
    databaseMeta: {
      schemaVersion: normalizedDatabase.schemaVersion,
      savedAt: normalizedDatabase.savedAt,
      revision: normalizedDatabase.meta.revision,
      saveCount: normalizedDatabase.meta.saveCount,
    },
  };
}
