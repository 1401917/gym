import { encrypt, decrypt, isCryptoSupported } from './crypto.js';
import { createDefaultAccessState, sanitizeAccessState } from './access.js';
import {
  buildDatabaseSnapshot,
  createDefaultDatabase,
  DATABASE_SCHEMA_VERSION,
  extractStateFromDatabase,
  normalizeDatabasePayload,
} from './database.js';
import { getCurrentTrackingDayStamp, isAutomaticResetEnabled } from './day-reset.js';
import { computeHmac, verifyStorage, generateMetadata, getStorageIntegrityKeys } from './tamper.js';
import { createReminderSettingsDefaults } from './reminders.js';
import { sanitizeSettings } from './validation.js';

const STORAGE_KEY = 'protein-flow-state-v2';
const AUTO_PASSPHRASE_KEY = `${STORAGE_KEY}-device-secret`;
const BACKUP_STORAGE_KEY = `${STORAGE_KEY}-backup`;
const STAGING_STORAGE_KEY = `${STORAGE_KEY}-staging`;
let cachedPassphrase = null;
let cachedDatabase = null;

function createStorageSlot(storageKey, source) {
  return {
    source,
    storageKey,
    ...getStorageIntegrityKeys(storageKey),
  };
}

const PRIMARY_SLOT = createStorageSlot(STORAGE_KEY, 'primary');
const STAGING_SLOT = createStorageSlot(STAGING_STORAGE_KEY, 'staging');
const BACKUP_SLOT = createStorageSlot(BACKUP_STORAGE_KEY, 'backup');
const STORAGE_SLOTS = [PRIMARY_SLOT, STAGING_SLOT, BACKUP_SLOT];

function padNumber(value) {
  return String(value).padStart(2, '0');
}

function parseDayStamp(dayStamp) {
  const parts = String(dayStamp || '').split('-').map(Number);
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
    return null;
  }

  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function getDayDifference(fromStamp, toStamp) {
  const fromDate = parseDayStamp(fromStamp);
  const toDate = parseDayStamp(toStamp);

  if (!fromDate || !toDate) {
    return null;
  }

  return Math.round((toDate - fromDate) / 86400000);
}

function createDefaultSettings() {
  return sanitizeSettings({
    language: 'he',
    defaultScreen: 'home',
    launchIntro: true,
    animations: 'full',
    goalGender: 'male',
    goalAge: '25',
    goalHeight: '170',
    goalWeight: '',
    goalType: 'maintain',
    goalTargetWeight: '',
    proteinGoal: '',
    calorieGoal: '',
    goalManualProteinDraft: '',
    goalManualCaloriesDraft: '',
    activityLevel: 'moderate',
    resetMode: 'auto',
    resetTime: '00:00',
    ...createReminderSettingsDefaults(),
  });
}

function createDefaultChatState() {
  return {
    currentState: 'root',
    messages: [],
  };
}

function summarizeLogItems(logItems) {
  return (logItems || []).reduce((summary, item) => ({
    totalProtein: summary.totalProtein + Number(item.protein || 0),
    totalCalories: summary.totalCalories + Number(item.calories || 0),
    itemCount: summary.itemCount + 1,
  }), { totalProtein: 0, totalCalories: 0, itemCount: 0 });
}

function appendHistoryEntry(history, entry) {
  const filtered = (Array.isArray(history) ? history : []).filter((item) => item.dayStamp !== entry.dayStamp);
  return [entry, ...filtered].slice(0, 180);
}

function createHistoryEntry(state) {
  const totals = summarizeLogItems(state.logItems);
  const items = (state.logItems || [])
    .filter((item) => item && typeof item === 'object' && (item.name || item.nameKey))
    .map((item) => ({
      name: String(item.name || '').trim(),
      nameKey: typeof item.nameKey === 'string' ? item.nameKey : '',
      protein: Math.max(0, Number(item.protein || 0)),
      calories: Math.max(0, Number(item.calories || 0)),
    }));

  return {
    dayStamp: state.dayStamp,
    totalProtein: totals.totalProtein,
    totalCalories: totals.totalCalories,
    itemCount: totals.itemCount,
    target: Number(state.target || 0),
    calorieTarget: Number(state.calorieTarget || 0),
    items,
  };
}

function readStoredBundle(slot) {
  return {
    data: localStorage.getItem(slot.dataKey),
    hmac: localStorage.getItem(slot.hmacKey),
    metadata: localStorage.getItem(slot.metadataKey),
  };
}

function hasStoredBundle(bundle) {
  return Boolean(bundle?.data);
}

function clearStoredBundle(slot) {
  localStorage.removeItem(slot.dataKey);
  localStorage.removeItem(slot.hmacKey);
  localStorage.removeItem(slot.metadataKey);
}

function writeStoredBundle(slot, bundle) {
  if (!hasStoredBundle(bundle)) {
    clearStoredBundle(slot);
    return;
  }

  localStorage.setItem(slot.dataKey, bundle.data);

  if (bundle.hmac) {
    localStorage.setItem(slot.hmacKey, bundle.hmac);
  } else {
    localStorage.removeItem(slot.hmacKey);
  }

  if (bundle.metadata) {
    localStorage.setItem(slot.metadataKey, bundle.metadata);
  } else {
    localStorage.removeItem(slot.metadataKey);
  }
}

function promoteStoredBundle(sourceSlot) {
  if (!sourceSlot || sourceSlot.storageKey === PRIMARY_SLOT.storageKey) {
    clearStoredBundle(STAGING_SLOT);
    return;
  }

  const bundle = readStoredBundle(sourceSlot);
  if (!hasStoredBundle(bundle)) {
    return;
  }

  writeStoredBundle(PRIMARY_SLOT, bundle);
  clearStoredBundle(STAGING_SLOT);
}

function persistStoredBundle(bundle) {
  const previousPrimaryBundle = readStoredBundle(PRIMARY_SLOT);

  try {
    writeStoredBundle(STAGING_SLOT, bundle);
  } catch (error) {
    console.error('Failed to stage the local database save.', error);
    return false;
  }

  try {
    if (hasStoredBundle(previousPrimaryBundle)) {
      writeStoredBundle(BACKUP_SLOT, previousPrimaryBundle);
    } else {
      clearStoredBundle(BACKUP_SLOT);
    }
  } catch (error) {
    console.warn('Could not refresh the backup database copy.', error);
  }

  try {
    writeStoredBundle(PRIMARY_SLOT, bundle);
    clearStoredBundle(STAGING_SLOT);
    return true;
  } catch (error) {
    console.error('Primary database write failed; keeping the staged copy for recovery.', error);
    return false;
  }
}

function generateAutomaticPassphrase() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${STORAGE_KEY}:${globalThis.crypto.randomUUID()}`;
  }

  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const randomBytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const randomHex = [...randomBytes].map((value) => value.toString(16).padStart(2, '0')).join('');
    return `${STORAGE_KEY}:${randomHex}`;
  }

  return `${STORAGE_KEY}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

function resolvePassphrase({ providedPassphrase = null, createIfMissing = true } = {}) {
  if (providedPassphrase) {
    cachedPassphrase = providedPassphrase;
    return providedPassphrase;
  }

  if (cachedPassphrase) {
    return cachedPassphrase;
  }

  const storedPassphrase = localStorage.getItem(AUTO_PASSPHRASE_KEY);
  if (storedPassphrase) {
    cachedPassphrase = storedPassphrase;
    return storedPassphrase;
  }

  if (!createIfMissing) {
    return null;
  }

  const automaticPassphrase = generateAutomaticPassphrase();
  if (!automaticPassphrase) {
    return null;
  }

  try {
    localStorage.setItem(AUTO_PASSPHRASE_KEY, automaticPassphrase);
    cachedPassphrase = automaticPassphrase;
    return automaticPassphrase;
  } catch {
    return null;
  }
}

function hydrateStateFromPayload(payload, defaultState, now = new Date()) {
  const database = normalizeDatabasePayload(payload, defaultState);
  let state = extractStateFromDatabase(database, defaultState);
  state = reconcileStateDay(state, now);

  return {
    database,
    state,
  };
}

export function getDayStamp(date = new Date()) {
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`;
}

export function createDefaultState() {
  const settings = createDefaultSettings();

  return {
    totalP: 0,
    totalC: 0,
    target: 0,
    calorieTarget: 0,
    meals: 4,
    streak: 0,
    logItems: [],
    history: [],
    chatState: createDefaultChatState(),
    settings,
    dayStamp: getCurrentTrackingDayStamp(settings),
    access: createDefaultAccessState(),
    recentFoods: [],
    databaseMeta: {
      schemaVersion: DATABASE_SCHEMA_VERSION,
      savedAt: null,
      revision: 0,
      saveCount: 0,
    },
  };
}

export function createDefaultSettingsState() {
  return createDefaultSettings();
}

export function rollStateToDay(state, nextDayStamp) {
  const dayDifference = getDayDifference(state.dayStamp, nextDayStamp);
  const shouldIncreaseStreak = state.logItems.length > 0 && dayDifference === 1;
  const history = state.logItems.length > 0
    ? appendHistoryEntry(state.history, createHistoryEntry(state))
    : (state.history || []);

  return {
    ...state,
    totalP: 0,
    totalC: 0,
    logItems: [],
    history,
    dayStamp: nextDayStamp,
    streak: shouldIncreaseStreak ? (state.streak || 0) + 1 : 0,
  };
}

export function reconcileStateDay(state, now = new Date()) {
  if (!state || !isAutomaticResetEnabled(state.settings || {})) {
    return state;
  }

  const trackingDayStamp = getCurrentTrackingDayStamp(state.settings || {}, now);
  if (state.dayStamp === trackingDayStamp) {
    return state;
  }

  const dayDifference = getDayDifference(state.dayStamp, trackingDayStamp);
  if (dayDifference === null || dayDifference <= 0) {
    return state;
  }

  return rollStateToDay(state, trackingDayStamp);
}

function tryLoadPlainCandidate(slot, defaultState, now = new Date()) {
  const bundle = readStoredBundle(slot);
  if (!bundle.data) {
    return null;
  }

  try {
    const parsed = JSON.parse(bundle.data);
    return {
      ...hydrateStateFromPayload(parsed, defaultState, now),
      slot,
    };
  } catch {
    return null;
  }
}

function loadBestPlainState(defaultState, now = new Date()) {
  for (const slot of STORAGE_SLOTS) {
    const candidate = tryLoadPlainCandidate(slot, defaultState, now);
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

async function tryLoadEncryptedCandidate(slot, passphrase, defaultState, now = new Date()) {
  const bundle = readStoredBundle(slot);
  if (!bundle.data || !bundle.hmac) {
    return null;
  }

  if (bundle.metadata) {
    const valid = await verifyStorage(passphrase, {
      metadata: bundle.metadata,
      storageKey: slot.storageKey,
    });

    if (!valid) {
      console.warn(`Skipped the ${slot.source} database copy because the integrity check failed.`);
      return null;
    }
  } else {
    console.warn(`Stored metadata missing for the ${slot.source} database copy, attempting legacy decrypt without tamper verification.`);
  }

  const decrypted = await decrypt(bundle.data, passphrase);
  if (!decrypted) {
    console.warn(`Skipped the ${slot.source} database copy because decryption failed.`);
    return null;
  }

  return {
    ...hydrateStateFromPayload(decrypted, defaultState, now),
    slot,
  };
}

async function loadBestEncryptedState(passphrase, defaultState, now = new Date()) {
  for (const slot of STORAGE_SLOTS) {
    const candidate = await tryLoadEncryptedCandidate(slot, passphrase, defaultState, now);
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

export async function loadState(passphrase = null, options = {}) {
  const defaultState = createDefaultState();
  const now = options.now instanceof Date ? options.now : new Date();
  let hydrated = null;
  let resolvedPassphrase = null;

  if (isCryptoSupported()) {
    resolvedPassphrase = resolvePassphrase({
      providedPassphrase: passphrase,
      createIfMissing: false,
    });

    if (resolvedPassphrase) {
      hydrated = await loadBestEncryptedState(resolvedPassphrase, defaultState, now);
    }
  } else {
    console.warn('Crypto not supported, using local database without encryption');
  }

  if (!hydrated) {
    hydrated = loadBestPlainState(defaultState, now);
  }

  if (!hydrated) {
    return defaultState;
  }

  promoteStoredBundle(hydrated.slot);
  cachedPassphrase = resolvedPassphrase;
  cachedDatabase = hydrated.database;

  return {
    ...hydrated.state,
    access: sanitizeAccessState(hydrated.state.access),
  };
}

export async function saveState(state, passphrase = null) {
  const defaultState = createDefaultState();
  const databasePayload = buildDatabaseSnapshot(
    state,
    cachedDatabase || createDefaultDatabase(defaultState),
    defaultState
  );

  if (isCryptoSupported()) {
    const resolvedPassphrase = resolvePassphrase({
      providedPassphrase: passphrase,
    });
    if (!resolvedPassphrase) {
      console.warn('Automatic storage key unavailable, saving local database as plaintext');
      cachedPassphrase = null;
      persistStoredBundle({
        data: JSON.stringify(databasePayload),
        hmac: null,
        metadata: null,
      });
      cachedDatabase = databasePayload;
      return;
    }

    const metadata = generateMetadata('1.0.0');
    const encrypted = await encrypt(databasePayload, resolvedPassphrase);
    const hmac = await computeHmac(encrypted, metadata, resolvedPassphrase);
    cachedPassphrase = resolvedPassphrase;
    cachedDatabase = databasePayload;
    persistStoredBundle({
      data: encrypted,
      hmac,
      metadata,
    });
    return;
  }

  persistStoredBundle({
    data: JSON.stringify(databasePayload),
    hmac: null,
    metadata: null,
  });
  cachedDatabase = databasePayload;
}
