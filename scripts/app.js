import { loadState, saveState, getDayStamp, createDefaultSettingsState } from './storage.js?v=20260325';
import { validateLogItem, sanitizeSettings } from './validation.js';
import { reconcileStateDay, rollStateToDay } from './storage.js?v=20260325';
import { createDefaultState } from './storage.js?v=20260325';
import { createRouter } from './router.js';
import { createChat } from './chat.js';
import { createUI } from './ui.js';
import { buildGoalRecommendation } from './offline-ai.js';
import {
  analyzeFoodPhoto,
  getStoredFoodScanApiKey,
  getStoredGeminiApiKey,
  hasEmbeddedFoodScanApiKey,
  storeFoodScanApiKey,
  storeGeminiApiKey,
} from './food-photo-ai.js';
import { calculateTarget } from './engine.js';
import { setupInstallPrompt, registerServiceWorker } from './pwa.js?v=20260325';
import { syncReminderSchedule } from './reminders.js';
import { getCurrentTrackingDayStamp, getNextAutomaticResetDate, isAutomaticResetEnabled } from './day-reset.js';
import { applyLanguage, DEFAULT_LANGUAGE, getLanguageMeta, getLanguageOptions, t } from './i18n.js';
import {
  buildAccessSnapshot,
  buildStoredAccessState,
  createDefaultAccessState,
  loadEarlyAccessDirectory,
  resolveEarlyAccess,
  sanitizeAccessState,
} from './access.js';
import { fetchBillingState, purchaseMonthlySubscription, restoreBillingPurchases } from './payments.js?v=20260325';
import { getLegalLinks, isTemporaryFreeAccessEnabled, SUBSCRIPTION_CONFIG } from './subscription-config.js';

const UPDATE_RELOAD_FLAG = 'protein-flow-update-applied';
const DRAWER_SNAP_THRESHOLD = 0.55;
const FOOD_SCAN_COPY = {
  he: {
    title: 'סריקת אוכל עם AI',
    subtitle: 'צלם או בחר תמונת מנה, ה-AI יזהה את המאכל, המרכיבים, הקלוריות והחלבון.',
    geminiKeyPlaceholder: 'Gemini API Key (חינמי)',
    keyNote: 'מפתח חינמי מ-ai.google.dev — נשמר רק על המכשיר שלך. אפשר להשאיר ריק.',
    pickerIdle: 'צלם או בחר תמונה',
    pickerSelected: 'התמונה מוכנה לניתוח',
    pickerMissing: 'לא נבחרה תמונה עדיין',
    analyze: 'סרוק אוכל עם AI',
    idleStatus: 'העלה תמונת אוכל, ה-AI יזהה את המנה, המרכיבים, הקלוריות והחלבון, ויבקש אישור להכניס לאפליקציה.',
    missingPhoto: 'בחר תמונה לפני שמתחילים.',
    analyzing: 'מנתח תמונה עם AI...',
    reviewReady: 'הסריקה הצליחה! בדוק את הפרטים ולחץ "הוסף ליומן" לאישור.',
    addedToast: '{{name}} נוסף לאפליקציה מאומדן AI',
    failedToast: 'סריקת האוכל נכשלה כרגע',
    addToLog: 'הוסף ליומן',
    editManually: 'ערוך ידנית',
    ingredients: 'מרכיבים',
    notes: 'הערה',
  },
  en: {
    title: 'AI food scan',
    subtitle: 'Take or choose a meal photo — the AI identifies the food, ingredients, calories and protein.',
    geminiKeyPlaceholder: 'Gemini API Key (free)',
    keyNote: 'Free key from ai.google.dev — stored only on this device. Leave empty to use the built-in key.',
    pickerIdle: 'Take or choose a photo',
    pickerSelected: 'Photo ready for analysis',
    pickerMissing: 'No photo selected yet',
    analyze: 'Scan food with AI',
    idleStatus: 'Upload a food photo and the AI will identify the meal, ingredients, calories and protein before asking to add it.',
    missingPhoto: 'Choose a photo before starting the scan.',
    analyzing: 'Analyzing image with AI...',
    reviewReady: 'Scan complete! Review the details and tap "Add to log" to confirm.',
    addedToast: '{{name}} was added from AI scan',
    failedToast: 'Food scan failed right now',
    addToLog: 'Add to log',
    editManually: 'Edit manually',
    ingredients: 'Ingredients',
    notes: 'Note',
  },
};

let state = await loadState(null, { shouldPrompt: false }).catch((error) => {
  console.error('App state failed to load during startup.', error);
  return createDefaultState();
});
let waitingWorker = null;
let drawerGesture = null;
let lastReminderSyncResult = null;
let accessActionInFlight = false;
let automaticResetTimer = null;
let earlyAccessDirectory = { updatedAt: null, phones: [] };
let billingStatus = {
  ok: false,
  configured: false,
  platform: 'web',
  status: 'checking',
  package: null,
  entitlement: null,
  managementUrl: '',
  verification: 'NOT_REQUESTED',
  errorMessage: '',
};
let accessSnapshot = buildAccessSnapshot({
  accessState: state.access,
  billingStatus,
});

state = {
  ...state,
  access: sanitizeAccessState(state.access || createDefaultAccessState()),
};

// Language is locked to Hebrew
state = {
  ...state,
  settings: {
    ...(state.settings || {}),
    language: DEFAULT_LANGUAGE,
  },
};

applyLanguage(DEFAULT_LANGUAGE);

function getCalculatedTargetsFromSettings(settings) {
  const result = calculateTarget({
    weight: parseFloat(settings?.goalWeight || 0),
    targetKg: parseFloat(settings?.goalTargetWeight || 0) || undefined,
    age: parseInt(settings?.goalAge || 25, 10),
    gender: settings?.goalGender || 'male',
    height: parseInt(settings?.goalHeight || 170, 10),
    activityLevel: settings?.activityLevel || 'moderate',
    goal: settings?.goalType || 'maintain',
    meals: 4,
    extraProtein: 0,
  });

  if (!result) {
    return {
      target: 0,
      calorieTarget: 0,
    };
  }

  return {
    target: Number(result.dailyTarget || 0),
    calorieTarget: Number(result.calorieTarget || 0),
  };
}

function getState() {
  return state;
}

async function setState(partial, passphrase = null) {
  state = {
    ...state,
    ...partial,
    access: sanitizeAccessState(partial.access ?? state.access),
  };
  await saveState(state);
}

function summarizeLogItems(logItems = []) {
  return (logItems || []).reduce((summary, item) => ({
    totalProtein: summary.totalProtein + Number(item.protein || 0),
    totalCalories: summary.totalCalories + Number(item.calories || 0),
  }), { totalProtein: 0, totalCalories: 0 });
}

function buildDailyTotalsPatch(logItems = []) {
  const totals = summarizeLogItems(logItems);
  return {
    totalP: totals.totalProtein,
    totalC: totals.totalCalories,
  };
}

function clearAutomaticResetTimer() {
  if (automaticResetTimer) {
    window.clearTimeout(automaticResetTimer);
    automaticResetTimer = null;
  }
}

function formatTrackingDayLabel(dayStamp = state.dayStamp) {
  const date = new Date(`${dayStamp || ''}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return dayStamp || 'â€”';
  }

  return date.toLocaleDateString(getLanguageMeta(state.settings?.language || DEFAULT_LANGUAGE).locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
  });
}

function getResetSettingsPreview() {
  const current = state.settings || {};
  const resetModeInput = document.getElementById('settingResetMode');
  const resetTimeInput = document.getElementById('settingResetTime');

  return sanitizeSettings({
    ...current,
    resetMode: resetModeInput?.value || current.resetMode || 'auto',
    resetTime: resetTimeInput?.value || current.resetTime || '00:00',
  });
}

function buildResetStatusMessage(settings = state.settings || {}) {
  const trackingDay = formatTrackingDayLabel(state.dayStamp);

  if (isAutomaticResetEnabled(settings)) {
    return t('settings.resetStatus.auto', {
      time: settings.resetTime || '00:00',
      day: trackingDay,
    });
  }

  return t('settings.resetStatus.manual', { day: trackingDay });
}

function renderResetControls(settings = state.settings || {}) {
  const timeGroup = document.getElementById('settingResetTimeGroup');
  const timeInput = document.getElementById('settingResetTime');
  const statusEl = document.getElementById('resetStatus');
  const isAuto = isAutomaticResetEnabled(settings);

  if (timeGroup) {
    timeGroup.hidden = !isAuto;
  }

  if (timeInput) {
    timeInput.disabled = !isAuto;
  }

  if (statusEl) {
    statusEl.textContent = buildResetStatusMessage(settings);
  }
}

async function ensureTrackingDayIsCurrent({ render = false } = {}) {
  const nextState = reconcileStateDay(state);
  if (nextState === state) {
    scheduleAutomaticResetCheck();
    return false;
  }

  state = nextState;
  await saveState(state);

  if (render) {
    refreshAppView();
  }

  renderResetControls();
  scheduleAutomaticResetCheck();
  return true;
}

function scheduleAutomaticResetCheck() {
  clearAutomaticResetTimer();

  if (!isAutomaticResetEnabled(state.settings || {})) {
    renderResetControls();
    return;
  }

  const nextResetAt = getNextAutomaticResetDate(state.settings || {});
  if (!nextResetAt) {
    renderResetControls();
    return;
  }

  const delay = Math.max(1000, nextResetAt.getTime() - Date.now());
  automaticResetTimer = window.setTimeout(() => {
    void ensureTrackingDayIsCurrent({ render: true });
  }, delay);

  renderResetControls();
}

async function handleManualTrackingReset() {
  if (!confirm(t('confirm.resetDay'))) {
    return;
  }

  const nextDayStamp = getCurrentTrackingDayStamp(state.settings || {});
  const nextState = state.dayStamp !== nextDayStamp
    ? rollStateToDay(state, nextDayStamp)
    : {
        ...state,
        logItems: [],
        ...buildDailyTotalsPatch([]),
      };

  state = nextState;
  await saveState(state);
  refreshAppView();
  renderResetControls();
  scheduleAutomaticResetCheck();
  ui.showToastUI(t('toast.dayReset'));
}

function normalizeGoalValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return '';
  }

  return String(Math.round(numeric));
}

function getTargetsFromSettings(settings) {
  const calculatedTargets = getCalculatedTargetsFromSettings(settings);

  return {
    target: Number(settings?.proteinGoal || 0) || calculatedTargets.target,
    calorieTarget: Number(settings?.calorieGoal || 0) || calculatedTargets.calorieTarget,
  };
}

function syncTargetsWithSettings() {
  const targets = getTargetsFromSettings(state.settings || {});

  if (
    Number(state.target || 0) === Number(targets.target || 0)
    && Number(state.calorieTarget || 0) === Number(targets.calorieTarget || 0)
  ) {
    return;
  }

  state = {
    ...state,
    target: targets.target,
    calorieTarget: targets.calorieTarget,
  };
}

syncTargetsWithSettings();

const initialDailyTotals = buildDailyTotalsPatch(state.logItems);
if (
  Number(state.totalP || 0) !== Number(initialDailyTotals.totalP || 0)
  || Number(state.totalC || 0) !== Number(initialDailyTotals.totalC || 0)
) {
  state = {
    ...state,
    ...initialDailyTotals,
  };
}

function getDrawerElements() {
  return {
    drawer: document.getElementById('appDrawer'),
    backdrop: document.getElementById('navDrawerBackdrop'),
    toggleBtn: document.getElementById('navDrawerToggleBtn'),
  };
}

function clearDrawerInlineStyles(drawer, backdrop) {
  if (drawer) {
    drawer.style.transform = '';
    drawer.style.transition = '';
  }

  if (backdrop) {
    backdrop.style.opacity = '';
    backdrop.style.pointerEvents = '';
    backdrop.style.transition = '';
  }
}

function previewDrawer(translateX, drawerWidth) {
  const { drawer, backdrop } = getDrawerElements();
  if (!drawer || !backdrop || !drawerWidth) {
    return 0;
  }

  const safeTranslate = Math.max(0, Math.min(drawerWidth, translateX));
  const openProgress = 1 - (safeTranslate / drawerWidth);

  document.body.dataset.drawerDragging = 'true';
  drawer.style.transition = 'none';
  drawer.style.transform = `translateX(${safeTranslate}px)`;
  backdrop.style.transition = 'none';
  backdrop.style.opacity = String(openProgress);
  backdrop.style.pointerEvents = openProgress > 0 ? 'auto' : 'none';

  return openProgress;
}

function beginDrawerGesture(pointerId, startX, mode) {
  const { drawer } = getDrawerElements();
  if (!drawer) {
    return false;
  }

  const drawerWidth = drawer.getBoundingClientRect().width;
  drawerGesture = {
    pointerId,
    startX,
    mode,
    drawerWidth,
    startTranslate: mode === 'open' ? drawerWidth : 0,
    progress: mode === 'open' ? 0 : 1,
  };

  previewDrawer(drawerGesture.startTranslate, drawerWidth);
  return true;
}

function finishDrawerGesture(pointerId) {
  if (!drawerGesture || drawerGesture.pointerId !== pointerId) {
    return;
  }

  const shouldOpen = drawerGesture.progress > DRAWER_SNAP_THRESHOLD;
  drawerGesture = null;
  setDrawerOpen(shouldOpen);
}

function setDrawerOpen(isOpen) {
  const { drawer, backdrop, toggleBtn } = getDrawerElements();
  document.body.dataset.drawerOpen = isOpen ? 'true' : 'false';
  delete document.body.dataset.drawerDragging;
  drawerGesture = null;
  clearDrawerInlineStyles(drawer, backdrop);

  if (toggleBtn) {
    toggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  }
}

const router = createRouter();
window.router = router;

const ui = createUI(getState, addItem, deleteItem, (message) => ui.showToastUI(message));
const chat = createChat(
  (message) => ui.showToastUI(message),
  getState().chatState,
  (chatState) => setState({ chatState })
);
window.chat = chat;

async function addItem(item) {
  if (accessSnapshot.locked) {
    renderAccessViews();
    return;
  }

  await ensureTrackingDayIsCurrent();
  const logItems = [...state.logItems, item];
  await setState({
    logItems,
    ...buildDailyTotalsPatch(logItems),
  });
  ui.renderAllLogs();
  ui.renderStats();
  renderResetControls();
}

async function deleteItem(index) {
  if (accessSnapshot.locked) {
    renderAccessViews();
    return;
  }

  await ensureTrackingDayIsCurrent();
  const logItems = state.logItems.filter((_, itemIndex) => itemIndex !== index);
  await setState({
    logItems,
    ...buildDailyTotalsPatch(logItems),
  });
  ui.renderAllLogs();
  ui.renderStats();
  renderResetControls();
  ui.showToastUI(t('toast.itemRemoved'));
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getFoodScanCopy(key, values = {}) {
  const language = (state.settings?.language || DEFAULT_LANGUAGE) === 'he' ? 'he' : 'en';
  const template = FOOD_SCAN_COPY[language]?.[key] || FOOD_SCAN_COPY.en[key] || '';
  return String(template).replace(/\{\{(\w+)\}\}/g, (_, token) => {
    const value = values[token];
    return value === undefined || value === null ? '' : String(value);
  });
}

function getGeminiKeyNote() {
  return getFoodScanCopy('keyNote');
}

function getGeminiKeyPlaceholder() {
  return getFoodScanCopy('geminiKeyPlaceholder');
}

function setFoodPhotoStatus(message = '', tone = 'neutral') {
  const statusEl = document.getElementById('foodPhotoStatus');
  if (!statusEl) return;

  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
}

function setFoodPhotoPreview(dataUrl = '') {
  const previewEl = document.getElementById('foodPhotoPreview');
  if (!previewEl) return;

  if (!dataUrl) {
    previewEl.hidden = true;
    previewEl.removeAttribute('src');
    return;
  }

  previewEl.src = dataUrl;
  previewEl.hidden = false;
}

function readFoodPhotoPreview(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Unable to read the selected image.'));
    reader.readAsDataURL(file);
  });
}

function updateFoodPhotoPickerState(file = null) {
  const pickerLabel = document.getElementById('foodPhotoPickerLabel');
  if (!pickerLabel) return;

  pickerLabel.textContent = file
    ? `${getFoodScanCopy('pickerSelected')}: ${file.name}`
    : getFoodScanCopy('pickerIdle');
}

function applyFoodPhotoScanCopy() {
  const titleEl = document.getElementById('foodPhotoScanTitle');
  const subtitleEl = document.getElementById('foodPhotoScanSubtitle');
  const geminiKeyInput = document.getElementById('geminiApiKeyInput');
  const noteEl = document.getElementById('foodPhotoKeyNote');
  const buttonEl = document.getElementById('analyzeFoodPhotoBtn');
  const fileInput = document.getElementById('foodPhotoInput');
  const statusEl = document.getElementById('foodPhotoStatus');
  const confirmBtn = document.getElementById('foodScanConfirmBtn');
  const editBtn = document.getElementById('foodScanEditBtn');
  const ingredientsLabel = document.getElementById('foodScanIngredientsLabel');

  if (titleEl) titleEl.textContent = getFoodScanCopy('title');
  if (subtitleEl) subtitleEl.textContent = getFoodScanCopy('subtitle');
  if (geminiKeyInput) geminiKeyInput.placeholder = getGeminiKeyPlaceholder();
  if (noteEl) noteEl.innerHTML = getFoodScanCopy('keyNote');
  if (buttonEl) buttonEl.textContent = getFoodScanCopy('analyze');
  if (confirmBtn) confirmBtn.textContent = getFoodScanCopy('addToLog');
  if (editBtn) editBtn.textContent = getFoodScanCopy('editManually');
  if (ingredientsLabel) ingredientsLabel.textContent = getFoodScanCopy('ingredients');
  updateFoodPhotoPickerState(fileInput?.files?.[0] || null);

  if (statusEl && !statusEl.textContent.trim()) {
    setFoodPhotoStatus(getFoodScanCopy('idleStatus'));
  }
}

function clearFoodPhotoSelection({ keepStatus = false } = {}) {
  const fileInput = document.getElementById('foodPhotoInput');
  if (fileInput) {
    fileInput.value = '';
  }

  updateFoodPhotoPickerState(null);
  setFoodPhotoPreview('');
  hideFoodScanResult();

  if (!keepStatus) {
    setFoodPhotoStatus(getFoodScanCopy('idleStatus'));
  }
}

function showFoodScanResult(result) {
  const resultEl = document.getElementById('foodScanResult');
  const nameEl = document.getElementById('foodScanResultName');
  const macrosEl = document.getElementById('foodScanResultMacros');
  const ingredientsSection = document.getElementById('foodScanIngredients');
  const tagsEl = document.getElementById('foodScanIngredientTags');
  const notesEl = document.getElementById('foodScanNotes');
  if (!resultEl) return;

  if (nameEl) nameEl.textContent = result.name;
  if (macrosEl) macrosEl.textContent = `${result.calories} cal · ${result.protein}g protein`;

  if (tagsEl && result.ingredients && result.ingredients.length > 0) {
    tagsEl.innerHTML = result.ingredients
      .map((ing) => `<span class="food-ingredient-tag">${ing}</span>`)
      .join('');
    if (ingredientsSection) ingredientsSection.hidden = false;
  } else if (ingredientsSection) {
    ingredientsSection.hidden = true;
  }

  if (notesEl) {
    if (result.notes) {
      notesEl.textContent = `${getFoodScanCopy('notes')}: ${result.notes}`;
      notesEl.hidden = false;
    } else {
      notesEl.hidden = true;
    }
  }

  resultEl.hidden = false;
  resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideFoodScanResult() {
  const resultEl = document.getElementById('foodScanResult');
  if (resultEl) resultEl.hidden = true;
}

function fillModalFoodFields(result) {
  const nameInput = document.getElementById('modalFoodName');
  const proteinInput = document.getElementById('modalFoodProtein');
  const caloriesInput = document.getElementById('modalFoodCalories');

  if (nameInput) nameInput.value = result.name;
  if (proteinInput) proteinInput.value = String(result.protein);
  if (caloriesInput) caloriesInput.value = String(result.calories);
}

function wireFoodPhotoScan() {
  const fileInput = document.getElementById('foodPhotoInput');
  const geminiKeyInput = document.getElementById('geminiApiKeyInput');
  const analyzeBtn = document.getElementById('analyzeFoodPhotoBtn');
  const confirmBtn = document.getElementById('foodScanConfirmBtn');
  const editBtn = document.getElementById('foodScanEditBtn');
  if (!fileInput || !analyzeBtn) return;

  if (geminiKeyInput && !geminiKeyInput.dataset.prefilledGeminiKey) {
    geminiKeyInput.value = getStoredGeminiApiKey(globalThis.localStorage);
    geminiKeyInput.dataset.prefilledGeminiKey = '1';
  }

  applyFoodPhotoScanCopy();

  if (!document.body.dataset.wiredFoodPhotoLanguage) {
    document.body.dataset.wiredFoodPhotoLanguage = '1';
    document.addEventListener('app-language-change', () => {
      applyFoodPhotoScanCopy();
    });
  }

  if (!fileInput.dataset.wiredFoodPhotoInput) {
    fileInput.dataset.wiredFoodPhotoInput = '1';
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0] || null;
      updateFoodPhotoPickerState(file);
      hideFoodScanResult();

      if (!file) {
        setFoodPhotoPreview('');
        setFoodPhotoStatus(getFoodScanCopy('pickerMissing'));
        return;
      }

      try {
        const previewUrl = await readFoodPhotoPreview(file);
        setFoodPhotoPreview(previewUrl);
      } catch {
        setFoodPhotoPreview('');
      }

      setFoodPhotoStatus(getFoodScanCopy('pickerSelected'));
    });
  }

  if (!analyzeBtn.dataset.wiredFoodPhotoAnalyze) {
    analyzeBtn.dataset.wiredFoodPhotoAnalyze = '1';
    analyzeBtn.addEventListener('click', async () => {
      const file = fileInput.files?.[0] || null;
      const geminiKey = geminiKeyInput ? storeGeminiApiKey(geminiKeyInput.value) : '';
      const nvidiaKey = getStoredFoodScanApiKey(globalThis.localStorage);

      if (!file) {
        setFoodPhotoStatus(getFoodScanCopy('missingPhoto'), 'error');
        ui.showToastUI(getFoodScanCopy('missingPhoto'));
        return;
      }

      analyzeBtn.disabled = true;
      hideFoodScanResult();
      setFoodPhotoStatus(getFoodScanCopy('analyzing'));

      try {
        const result = await analyzeFoodPhoto({
          file,
          geminiApiKey: geminiKey,
          apiKey: nvidiaKey,
        });

        fillModalFoodFields(result);
        showFoodScanResult(result);
        setFoodPhotoStatus(getFoodScanCopy('reviewReady'), 'success');

        analyzeBtn._lastScanResult = result;
      } catch (error) {
        const message = error?.message || getFoodScanCopy('failedToast');
        console.error('Food photo scan failed.', error);
        setFoodPhotoStatus(message, 'error');
        ui.showToastUI(message);
      } finally {
        analyzeBtn.disabled = false;
      }
    });
  }

  if (confirmBtn && !confirmBtn.dataset.wiredFoodScanConfirm) {
    confirmBtn.dataset.wiredFoodScanConfirm = '1';
    confirmBtn.addEventListener('click', async () => {
      const result = analyzeBtn._lastScanResult;
      if (!result) return;

      try {
        await addItem(validateLogItem({
          name: result.name,
          protein: result.protein,
          calories: result.calories,
        }));

        document.getElementById('modalFoodName').value = '';
        document.getElementById('modalFoodProtein').value = '';
        document.getElementById('modalFoodCalories').value = '';
        document.getElementById('quickAddModal').classList.remove('open');
        clearFoodPhotoSelection();
        analyzeBtn._lastScanResult = null;
        ui.showToastUI(getFoodScanCopy('addedToast', { name: result.name }));
      } catch (error) {
        ui.showToastUI(error?.message || getFoodScanCopy('failedToast'));
      }
    });
  }

  if (editBtn && !editBtn.dataset.wiredFoodScanEdit) {
    editBtn.dataset.wiredFoodScanEdit = '1';
    editBtn.addEventListener('click', () => {
      hideFoodScanResult();
      setFoodPhotoStatus(getFoodScanCopy('reviewReady'));
      document.getElementById('modalFoodName')?.focus();
    });
  }
}

function setLaunchState(status, progress) {
  const statusEl = document.getElementById('launchStatus');
  const progressEl = document.getElementById('launchProgressBar');
  if (statusEl) statusEl.textContent = status;
  if (progressEl) progressEl.style.width = `${progress}%`;
}

function finishLaunch() {
  const launchScreen = document.getElementById('launchScreen');
  if (!launchScreen) return;

  launchScreen.classList.add('hide');
  window.setTimeout(() => {
    launchScreen.hidden = true;
  }, 500);
}

function showUpdateBanner(worker) {
  waitingWorker = worker;

  const banner = document.getElementById('updateBanner');
  const updateBtn = document.getElementById('updateBtn');
  if (!banner || !updateBtn) return;

  banner.hidden = false;
  updateBtn.onclick = () => {
    banner.hidden = true;
    sessionStorage.setItem(UPDATE_RELOAD_FLAG, '1');
    waitingWorker?.postMessage({ type: 'SKIP_WAITING' });
  };
}

function applySettingsToUI() {
  document.body.dataset.animations = state.settings?.animations || 'full';
  applyLanguage(DEFAULT_LANGUAGE);
}

function formatAccessDate(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleDateString(getLanguageMeta(state.settings?.language || DEFAULT_LANGUAGE).locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function setAccessLocked(isLocked) {
  document.body.dataset.accessLocked = isLocked ? 'true' : 'false';
}

function getAccessBadgeLabel(snapshot = accessSnapshot) {
  if (snapshot.status === 'active') return t('membership.badge.active');
  if (snapshot.status === 'trial') return t('membership.badge.trial');
  if (snapshot.status === 'early-access') return t('membership.badge.earlyAccess');
  if (snapshot.status === 'unconfigured') return t('membership.badge.unconfigured');
  if (snapshot.status === 'unsupported') return t('membership.badge.unsupported');
  if (snapshot.status === 'error') return t('membership.badge.error');
  if (snapshot.status === 'checking') return t('membership.badge.checking');
  return t('membership.badge.locked');
}

function buildMembershipStatusText(snapshot = accessSnapshot) {
  if (snapshot.status === 'active') {
    const renewal = snapshot.expiresAt ? ` until ${formatAccessDate(snapshot.expiresAt)}` : '';
    return t('membership.status.active', { renewal });
  }

  if (snapshot.status === 'trial') {
    return t('membership.status.trial', {
      date: formatAccessDate(snapshot.expiresAt) || 'the end of the trial',
    });
  }

  if (snapshot.status === 'early-access') {
    return t('membership.status.earlyAccess');
  }

  if (snapshot.status === 'unconfigured') {
    return t('membership.status.unconfigured');
  }

  if (snapshot.status === 'unsupported') {
    return t('membership.status.unsupported');
  }

  if (snapshot.status === 'error') {
    return t('membership.status.error');
  }

  if (snapshot.status === 'checking') {
    return t('membership.status.checking');
  }

  return t('membership.status.locked');
}

function buildMembershipDetailText(snapshot = accessSnapshot) {
  if (snapshot.status === 'active') return t('membership.note.active');
  if (snapshot.status === 'trial') return t('membership.note.trial');
  if (snapshot.status === 'early-access') return t('membership.note.earlyAccess');
  if (snapshot.status === 'unconfigured') return t('membership.note.unconfigured');
  if (snapshot.status === 'unsupported') return t('membership.note.unsupported');
  return t('membership.note.locked');
}

function toggleMembershipActionButtons(showPurchaseActions) {
  const purchaseIds = ['purchaseSubscriptionBtn', 'settingsPurchaseSubscriptionBtn'];
  const restoreIds = ['restorePurchasesBtn', 'settingsRestorePurchasesBtn'];

  purchaseIds.forEach((id) => {
    const button = document.getElementById(id);
    if (!button) return;

    button.hidden = !showPurchaseActions;
    button.disabled = accessActionInFlight || accessSnapshot.status === 'checking';
  });

  restoreIds.forEach((id) => {
    const button = document.getElementById(id);
    if (!button) return;

    button.hidden = !showPurchaseActions;
    button.disabled = accessActionInFlight || accessSnapshot.status === 'checking';
  });
}

function renderAccessViews() {
  const legalLinks = getLegalLinks();
  ['accessPrivacyLink', 'membershipPrivacyLink'].forEach((id) => {
    const link = document.getElementById(id);
    if (link) link.href = legalLinks.privacy;
  });
  ['accessTermsLink', 'membershipTermsLink'].forEach((id) => {
    const link = document.getElementById(id);
    if (link) link.href = legalLinks.terms;
  });

  const accessGate = document.getElementById('accessGate');
  const accessStatusText = document.getElementById('accessStatusText');
  const accessStatusBadge = document.getElementById('accessStatusBadge');
  const accessPriceLabel = document.getElementById('accessPriceLabel');
  const accessTrialLabel = document.getElementById('accessTrialLabel');
  const membershipStatusText = document.getElementById('membershipStatusText');
  const membershipStatusBadge = document.getElementById('membershipStatusBadge');
  const membershipDetailNote = document.getElementById('membershipDetailNote');
  const manageSubscriptionBtn = document.getElementById('manageSubscriptionBtn');

  const badgeLabel = getAccessBadgeLabel();
  const statusText = buildMembershipStatusText();
  const detailText = buildMembershipDetailText();
  const priceString = accessSnapshot.package?.priceString || t('membership.price.monthly');
  const trialLabel = accessSnapshot.package?.trialLabel || t('membership.trial.default');
  const showPurchaseActions = !accessSnapshot.granted;

  setAccessLocked(accessSnapshot.locked);
  if (accessGate) {
    accessGate.hidden = accessSnapshot.granted;
  }

  if (accessStatusText) accessStatusText.textContent = statusText;
  if (accessStatusBadge) accessStatusBadge.textContent = badgeLabel;
  if (accessPriceLabel) accessPriceLabel.textContent = priceString;
  if (accessTrialLabel) accessTrialLabel.textContent = trialLabel;

  if (membershipStatusText) membershipStatusText.textContent = statusText;
  if (membershipStatusBadge) membershipStatusBadge.textContent = badgeLabel;
  if (membershipDetailNote) membershipDetailNote.textContent = detailText;
  if (manageSubscriptionBtn) {
    manageSubscriptionBtn.hidden = !accessSnapshot.managementUrl;
  }

  toggleMembershipActionButtons(showPurchaseActions);
}

async function refreshAccessControl({ forceSync = false, persist = true, billingStatusOverride = null } = {}) {
  const currentAccessState = sanitizeAccessState(state.access);

  if (isTemporaryFreeAccessEnabled()) {
    earlyAccessDirectory = {
      updatedAt: null,
      phones: [],
    };
    billingStatus = {
      ok: true,
      configured: false,
      platform: 'web',
      status: 'temporary-free',
      package: null,
      entitlement: null,
      managementUrl: '',
      verification: 'NOT_REQUESTED',
      errorMessage: '',
    };
  } else {
    earlyAccessDirectory = await loadEarlyAccessDirectory();
    billingStatus = billingStatusOverride || await fetchBillingState(currentAccessState, SUBSCRIPTION_CONFIG, {
      forceSync,
    });
  }

  const earlyAccessResult = resolveEarlyAccess(earlyAccessDirectory, currentAccessState.phoneNumber);
  accessSnapshot = buildAccessSnapshot({
    accessState: currentAccessState,
    earlyAccessResult,
    billingStatus,
    freeAccessEnabled: isTemporaryFreeAccessEnabled(),
  });

  const nextAccessState = buildStoredAccessState(currentAccessState, accessSnapshot);
  const hasChanged = JSON.stringify(currentAccessState) !== JSON.stringify(nextAccessState);

  state = {
    ...state,
    access: nextAccessState,
  };

  if (persist && hasChanged) {
    await saveState(state);
  }

  renderAccessViews();
  return accessSnapshot;
}

async function handleMembershipPurchase() {
  if (accessActionInFlight) {
    return;
  }

  if (accessSnapshot.status === 'unsupported') {
    ui.showToastUI(t('toast.billingUnavailable'));
    return;
  }

  if (accessSnapshot.status === 'unconfigured') {
    ui.showToastUI(t('toast.billingNotConfigured'));
    return;
  }

  accessActionInFlight = true;
  renderAccessViews();

  const purchaseResult = await purchaseMonthlySubscription(state.access, SUBSCRIPTION_CONFIG);
  accessActionInFlight = false;
  await refreshAccessControl({
    billingStatusOverride: purchaseResult,
    persist: true,
  });

  if (accessSnapshot.granted) {
    refreshAppView();
    populateSettingsForm();
    populateGoalsForm();
    if (state.settings?.reminderEnabled) {
      await syncReminders({
        requestPermission: false,
        showToast: false,
      });
    }
    ui.showToastUI(t('toast.subscriptionActivated'));
    return;
  }

  if (purchaseResult.status !== 'cancelled') {
    ui.showToastUI(buildMembershipStatusText());
  }
}

async function handleMembershipRestore() {
  if (accessActionInFlight) {
    return;
  }

  if (accessSnapshot.status === 'unsupported') {
    ui.showToastUI(t('toast.billingUnavailable'));
    return;
  }

  if (accessSnapshot.status === 'unconfigured') {
    ui.showToastUI(t('toast.billingNotConfigured'));
    return;
  }

  accessActionInFlight = true;
  renderAccessViews();

  const restoreResult = await restoreBillingPurchases(state.access, SUBSCRIPTION_CONFIG);
  accessActionInFlight = false;
  await refreshAccessControl({
    billingStatusOverride: restoreResult,
    persist: true,
  });

  if (accessSnapshot.granted) {
    refreshAppView();
    populateSettingsForm();
    populateGoalsForm();
    ui.showToastUI(t('toast.purchaseRestored'));
    return;
  }

  ui.showToastUI(buildMembershipStatusText());
}

function buildReminderStatusMessage(result = lastReminderSyncResult) {
  const reminderTime = state.settings?.reminderTime || '19:00';

  if (!state.settings?.reminderEnabled) {
    return t('settings.reminderStatus.disabled');
  }

  if (!result) {
    return t('settings.reminderStatus.permissionRequired');
  }

  if (result.status === 'scheduled' && result.platform === 'native' && result.exactAlarm === 'denied') {
    return t('settings.reminderStatus.exactAlarmDenied', { time: reminderTime });
  }

  if (result.status === 'scheduled' && result.platform === 'native') {
    return t('settings.reminderStatus.scheduledNative', { time: reminderTime });
  }

  if (result.status === 'scheduled' && result.platform === 'web') {
    return t('settings.reminderStatus.scheduledWeb', { time: reminderTime });
  }

  if (result.status === 'permission-denied') {
    return t('settings.reminderStatus.permissionDenied');
  }

  if (result.status === 'unsupported') {
    return t('settings.reminderStatus.unsupported');
  }

  if (result.status === 'error') {
    return t('settings.reminderStatus.error');
  }

  return t('settings.reminderStatus.permissionRequired');
}

function renderReminderStatus() {
  const statusEl = document.getElementById('reminderStatus');
  if (!statusEl) {
    return;
  }

  statusEl.textContent = buildReminderStatusMessage();
}

async function syncReminders({ requestPermission = false, showToast = false } = {}) {
  try {
    lastReminderSyncResult = await syncReminderSchedule(state.settings || {}, state, {
      requestPermission,
    });
  } catch {
    lastReminderSyncResult = {
      ok: false,
      status: 'error',
      platform: 'web',
    };
  }
  renderReminderStatus();

  if (!showToast) {
    return;
  }

  if (lastReminderSyncResult.status === 'disabled') {
    ui.showToastUI(t('toast.reminderDisabled'));
    return;
  }

  if (lastReminderSyncResult.status === 'scheduled') {
    ui.showToastUI(t('toast.reminderScheduled'));
    return;
  }

  ui.showToastUI(buildReminderStatusMessage(lastReminderSyncResult));
}

function buildGoalProfileSummary() {
  const settings = state.settings || {};

  if (!settings.goalAge || !settings.goalHeight || !settings.goalWeight) {
    return t('goals.profileSummary.empty');
  }

  return t('goals.profileSummary.ready', {
    age: settings.goalAge,
    weight: settings.goalWeight,
    goal: t(`goal.${settings.goalType || 'maintain'}`),
    activity: t(`activity.${settings.activityLevel || 'moderate'}`),
  });
}

function renderGoalProfileSummary() {
  const summary = document.getElementById('goalsProfileSummary');
  if (!summary) return;

  summary.textContent = buildGoalProfileSummary();
}

function restoreGoalSummary() {
  const summary = document.getElementById('goalsSummary');
  const gscDaily = document.getElementById('gscDaily');
  const gscCalories = document.getElementById('gscCalories');
  const goalSummaryBadge = document.getElementById('goalSummaryBadge');
  const settings = state.settings || {};
  const hasManualTargets = Boolean(Number(settings.proteinGoal || 0) || Number(settings.calorieGoal || 0));
  const hasTargets = Boolean(Number(state.target || 0) || Number(state.calorieTarget || 0));

  if (summary) {
    summary.style.display = hasTargets ? 'grid' : 'none';
  }

  if (gscDaily) gscDaily.textContent = state.target ? `${state.target}g` : 'â€”';
  if (gscCalories) gscCalories.textContent = state.calorieTarget ? `${state.calorieTarget}` : 'â€”';
  if (goalSummaryBadge) {
    goalSummaryBadge.textContent = hasTargets
      ? (hasManualTargets ? t('goals.badge.manual') : t('goals.badge.recommendation'))
      : t('goals.badge.recommendation');
  }
}

function populateSettingsForm() {
  const settings = sanitizeSettings(state.settings || {});

  const mapping = {
    settingDefaultScreen: settings.defaultScreen || 'home',
    settingAnimations: settings.animations || 'full',
    settingProteinGoal: settings.proteinGoal || '',
    settingCalorieGoal: settings.calorieGoal || '',
    settingReminderTime: settings.reminderTime || '19:00',
    settingResetMode: settings.resetMode || 'auto',
    settingResetTime: settings.resetTime || '00:00',
    settingLanguage: settings.language || DEFAULT_LANGUAGE,
    settingGoalGender: settings.goalGender || 'male',
    settingGoalAge: settings.goalAge || '25',
    settingGoalHeight: settings.goalHeight || '170',
    settingGoalWeight: settings.goalWeight || '',
    settingGoalType: settings.goalType || 'maintain',
    settingGoalTargetWeight: settings.goalTargetWeight || '',
    settingGoalActivity: settings.activityLevel || 'moderate',
  };

  Object.entries(mapping).forEach(([id, value]) => {
    const input = document.getElementById(id);
    if (input) input.value = value;
  });

  const launchIntro = document.getElementById('settingLaunchIntro');
  if (launchIntro) {
    launchIntro.checked = settings.launchIntro !== false;
  }

  const reminderEnabled = document.getElementById('settingReminderEnabled');
  if (reminderEnabled) {
    reminderEnabled.checked = Boolean(settings.reminderEnabled);
  }

  renderLanguageOptions(document.getElementById('settingLanguageSearch')?.value || '');
  renderReminderStatus();
  renderResetControls(settings);
  renderAccessViews();
}

function populateGoalsForm() {
  renderGoalProfileSummary();
}

function refreshAppView() {
  applySettingsToUI();
  renderAccessViews();
  renderResetControls();

  if (accessSnapshot.locked) {
    return;
  }

  router.refreshLabels();
  ui.renderAll();
  restoreGoalSummary();
  renderGoalProfileSummary();
  renderLanguageOptions(document.getElementById('settingLanguageSearch')?.value || '');
  renderReminderStatus();
  renderResetControls();
}

function getGoalInputs() {
  const settings = state.settings || {};

  return {
    weight: parseFloat(document.getElementById('settingGoalWeight')?.value || settings.goalWeight || 0),
    targetKg: parseFloat(document.getElementById('settingGoalTargetWeight')?.value || settings.goalTargetWeight || 0) || undefined,
    age: parseInt(document.getElementById('settingGoalAge')?.value || settings.goalAge || 25, 10),
    gender: document.getElementById('settingGoalGender')?.value || settings.goalGender || 'male',
    height: parseInt(document.getElementById('settingGoalHeight')?.value || settings.goalHeight || 170, 10),
    activityLevel: document.getElementById('settingGoalActivity')?.value || settings.activityLevel || 'moderate',
    goal: document.getElementById('settingGoalType')?.value || settings.goalType || 'maintain',
    meals: 4,
    extraProtein: 0,
  };
}

function getGoalProfileDraftInputs() {
  const settings = state.settings || {};

  return {
    goalGender: document.getElementById('settingGoalGender')?.value || settings.goalGender || 'male',
    goalAge: document.getElementById('settingGoalAge')?.value || settings.goalAge || '25',
    goalHeight: document.getElementById('settingGoalHeight')?.value || settings.goalHeight || '170',
    goalWeight: document.getElementById('settingGoalWeight')?.value || settings.goalWeight || '',
    goalType: document.getElementById('settingGoalType')?.value || settings.goalType || 'maintain',
    goalTargetWeight: document.getElementById('settingGoalTargetWeight')?.value || settings.goalTargetWeight || '',
    activityLevel: document.getElementById('settingGoalActivity')?.value || settings.activityLevel || 'moderate',
  };
}

function persistGoalDraftInputs() {
  setState({
    settings: {
      ...(state.settings || {}),
      ...getGoalProfileDraftInputs(),
    },
  });
  renderGoalProfileSummary();
}

function getSettingsInputs() {
  const current = state.settings || {};

  return sanitizeSettings({
    ...current,
    defaultScreen: document.getElementById('settingDefaultScreen')?.value || 'home',
    language: DEFAULT_LANGUAGE,
    launchIntro: Boolean(document.getElementById('settingLaunchIntro')?.checked),
    animations: document.getElementById('settingAnimations')?.value || 'full',
    reminderEnabled: Boolean(document.getElementById('settingReminderEnabled')?.checked),
    reminderTime: document.getElementById('settingReminderTime')?.value || current.reminderTime || '19:00',
    resetMode: document.getElementById('settingResetMode')?.value || current.resetMode || 'auto',
    resetTime: document.getElementById('settingResetTime')?.value || current.resetTime || '00:00',
    goalGender: document.getElementById('settingGoalGender')?.value || current.goalGender || 'male',
    goalAge: document.getElementById('settingGoalAge')?.value || current.goalAge || '25',
    goalHeight: document.getElementById('settingGoalHeight')?.value || current.goalHeight || '170',
    goalWeight: document.getElementById('settingGoalWeight')?.value || current.goalWeight || '',
    goalType: document.getElementById('settingGoalType')?.value || current.goalType || 'maintain',
    goalTargetWeight: document.getElementById('settingGoalTargetWeight')?.value || current.goalTargetWeight || '',
    activityLevel: document.getElementById('settingGoalActivity')?.value || current.activityLevel || 'moderate',
    proteinGoal: normalizeGoalValue(document.getElementById('settingProteinGoal')?.value || ''),
    calorieGoal: normalizeGoalValue(document.getElementById('settingCalorieGoal')?.value || ''),
  });
}

function renderLanguageOptions(query = '') {
  const list = document.getElementById('languageOptionsList');
  const badge = document.getElementById('languageCurrentBadge');
  const hiddenInput = document.getElementById('settingLanguage');
  if (!list || !hiddenInput) return;

  const activeCode = hiddenInput.value || state.settings?.language || DEFAULT_LANGUAGE;
  const normalizedQuery = String(query || '').trim().toLowerCase();
  const options = getLanguageOptions().filter((option) => {
    if (!normalizedQuery) return true;
    return [option.code, option.englishName, option.nativeName]
      .join(' ')
      .toLowerCase()
      .includes(normalizedQuery);
  });

  list.innerHTML = '';
  options.forEach((option) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `language-option${option.code === activeCode ? ' active' : ''}`;
    button.innerHTML = `
      <strong>${option.nativeName}</strong>
      <span>${option.englishName}</span>
    `;
    button.addEventListener('click', () => {
      hiddenInput.value = option.code;
      const nextSettings = getSettingsInputs();
      setState({ settings: nextSettings });
      refreshAppView();
      populateSettingsForm();
      ui.showToastUI(t('settings.language.changed', { language: option.nativeName }));
    });
    list.appendChild(button);
  });

  const activeMeta = getLanguageMeta(activeCode);
  if (badge) badge.textContent = activeMeta.nativeName;
}

function wireLanguagePicker() {
  const input = document.getElementById('settingLanguageSearch');
  if (!input || input.dataset.wired) return;

  input.dataset.wired = '1';
  input.addEventListener('input', () => {
    renderLanguageOptions(input.value);
  });
}

function wireGoalDraftPersistence() {
  const fieldIds = [
    'settingGoalGender',
    'settingGoalAge',
    'settingGoalHeight',
    'settingGoalWeight',
    'settingGoalType',
    'settingGoalTargetWeight',
    'settingGoalActivity',
  ];

  fieldIds.forEach((id) => {
    const input = document.getElementById(id);
    if (!input || input.dataset.wiredDraft) return;

    input.dataset.wiredDraft = '1';
    const eventName = input.tagName === 'SELECT' ? 'change' : 'input';
    input.addEventListener(eventName, () => {
      persistGoalDraftInputs();
    });
  });
}

function wireResetControls() {
  const modeInput = document.getElementById('settingResetMode');
  const timeInput = document.getElementById('settingResetTime');

  if (modeInput && !modeInput.dataset.wiredResetMode) {
    modeInput.dataset.wiredResetMode = '1';
    modeInput.addEventListener('change', () => {
      renderResetControls(getResetSettingsPreview());
    });
  }

  if (timeInput && !timeInput.dataset.wiredResetTime) {
    timeInput.dataset.wiredResetTime = '1';
    timeInput.addEventListener('input', () => {
      renderResetControls(getResetSettingsPreview());
    });
  }

  if (!document.body.dataset.wiredTrackingResetLifecycle) {
    document.body.dataset.wiredTrackingResetLifecycle = '1';

    const syncCurrentDay = () => {
      void ensureTrackingDayIsCurrent({ render: true });
    };

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        syncCurrentDay();
      }
    });

    window.addEventListener('focus', syncCurrentDay);
  }
}

function wireNavigationDrawer() {
  const toggleBtn = document.getElementById('navDrawerToggleBtn');
  const closeBtn = document.getElementById('navDrawerCloseBtn');
  const backdrop = document.getElementById('navDrawerBackdrop');
  const drawer = document.getElementById('appDrawer');
  const swipeZone = document.getElementById('drawerSwipeZone');

  if (toggleBtn && !toggleBtn.dataset.wired) {
    toggleBtn.dataset.wired = '1';
    toggleBtn.addEventListener('click', () => {
      setDrawerOpen(document.body.dataset.drawerOpen !== 'true');
    });
  }

  if (closeBtn && !closeBtn.dataset.wired) {
    closeBtn.dataset.wired = '1';
    closeBtn.addEventListener('click', () => setDrawerOpen(false));
  }

  if (backdrop && !backdrop.dataset.wired) {
    backdrop.dataset.wired = '1';
    backdrop.addEventListener('click', () => setDrawerOpen(false));
  }

  if (swipeZone && !swipeZone.dataset.wiredSwipe) {
    swipeZone.dataset.wiredSwipe = '1';
    swipeZone.addEventListener('pointerdown', (event) => {
      if ((event.pointerType === 'mouse' && event.button !== 0) || document.body.dataset.drawerOpen === 'true') {
        return;
      }

      beginDrawerGesture(event.pointerId, event.clientX, 'open');
    });
  }

  if (drawer && !drawer.dataset.wiredSwipe) {
    drawer.dataset.wiredSwipe = '1';
    drawer.addEventListener('pointerdown', (event) => {
      if ((event.pointerType === 'mouse' && event.button !== 0) || document.body.dataset.drawerOpen !== 'true') {
        return;
      }

      beginDrawerGesture(event.pointerId, event.clientX, 'close');
    });
  }

  document.querySelectorAll('.side-nav .nav-item').forEach((button) => {
    if (button.dataset.wiredDrawer) return;

    button.dataset.wiredDrawer = '1';
    button.addEventListener('click', () => setDrawerOpen(false));
  });

  if (!document.body.dataset.wiredDrawerEscape) {
    document.body.dataset.wiredDrawerEscape = '1';
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        setDrawerOpen(false);
      }
    });

    window.addEventListener('pointermove', (event) => {
      if (!drawerGesture || drawerGesture.pointerId !== event.pointerId) {
        return;
      }

      event.preventDefault();
      const translate = drawerGesture.startTranslate + (event.clientX - drawerGesture.startX);
      drawerGesture.progress = previewDrawer(translate, drawerGesture.drawerWidth);
    }, { passive: false });

    window.addEventListener('pointerup', (event) => {
      finishDrawerGesture(event.pointerId);
    });

    window.addEventListener('pointercancel', (event) => {
      finishDrawerGesture(event.pointerId);
    });
  }

  setDrawerOpen(false);
  window.appMenu = {
    open: () => setDrawerOpen(true),
    close: () => setDrawerOpen(false),
    toggle: () => setDrawerOpen(document.body.dataset.drawerOpen !== 'true'),
  };
}

function wireModalAdd() {
  const btn = document.getElementById('modalAddBtn');
  if (!btn || btn.dataset.wiredModalAdd) return;

  btn.dataset.wiredModalAdd = '1';
  btn.addEventListener('click', () => {
    const name = document.getElementById('modalFoodName')?.value.trim();
    const protein = parseFloat(document.getElementById('modalFoodProtein')?.value || 0);
    const calories = parseFloat(document.getElementById('modalFoodCalories')?.value || 0);

    try {
      addItem(validateLogItem({
        name,
        protein: Number.isNaN(protein) ? 0 : protein,
        calories: Number.isNaN(calories) ? 0 : calories,
      }));
    } catch {
      ui.showToastUI(t('food.validation.name'));
      return;
    }

    document.getElementById('modalFoodName').value = '';
    document.getElementById('modalFoodProtein').value = '';
    document.getElementById('modalFoodCalories').value = '';
    document.getElementById('quickAddModal').classList.remove('open');
    ui.showToastUI(t('food.toast.added', { name }));
  });
}

function wireManualAdd() {
  const btn = document.getElementById('addFoodBtn');
  if (!btn || btn.dataset.wiredManualAdd) return;

  btn.dataset.wiredManualAdd = '1';
  btn.addEventListener('click', () => {
    const name = document.getElementById('foodName')?.value.trim();
    const protein = parseFloat(document.getElementById('foodProtein')?.value || 0);
    const calories = parseFloat(document.getElementById('foodCalories')?.value || 0);

    try {
      addItem(validateLogItem({
        name,
        protein,
        calories: Number.isNaN(calories) ? 0 : calories,
      }));
    } catch (error) {
      ui.showToastUI(error?.message?.includes('protein') ? t('food.validation.protein') : t('food.validation.name'));
      return;
    }

    document.getElementById('foodName').value = '';
    document.getElementById('foodProtein').value = '';
    document.getElementById('foodCalories').value = '';
    ui.showToastUI(t('food.toast.added', { name }));
  });
}

function wireResetDay() {
  const btn = document.getElementById('resetTrackingDayBtn') || document.getElementById('resetDayBtn');
  if (!btn || btn.dataset.wiredTrackingResetLegacy) return;

  btn.dataset.wiredTrackingResetLegacy = '1';
  btn.addEventListener('click', async () => {
    await handleManualTrackingReset();
  });
}

function wireAIGoals() {
  const btn = document.getElementById('aiGoalBtn');
  if (!btn || btn.dataset.wiredAiGoal) return;

  btn.dataset.wiredAiGoal = '1';
  btn.addEventListener('click', async () => {
    const inputs = getGoalInputs();
    if (!inputs.weight || inputs.weight < 30) {
      ui.showToastUI(t('goals.toast.fillPersonal'));
      return;
    }

    persistGoalDraftInputs();

    const resultEl = document.getElementById('aiGoalResult');
    const textEl = document.getElementById('aiGoalText');

    if (resultEl) resultEl.style.display = 'block';
    if (textEl) textEl.innerHTML = `<span class="ai-loading">${t('goals.ai.loading')}</span>`;
    btn.disabled = true;

    try {
      await sleep(320);
      const text = buildGoalRecommendation(inputs);
      if (textEl) textEl.textContent = text;
    } catch {
      if (textEl) textEl.textContent = t('goals.ai.error');
    } finally {
      btn.disabled = false;
    }
  });
}

function wireSettings() {
  const saveBtn = document.getElementById('saveSettingsBtn');
  const resetBtn = document.getElementById('resetSettingsBtn');
  const status = document.getElementById('settingsStatus');
  const purchaseButtons = ['purchaseSubscriptionBtn', 'settingsPurchaseSubscriptionBtn'];
  const restoreButtons = ['restorePurchasesBtn', 'settingsRestorePurchasesBtn'];
  const manageSubscriptionBtn = document.getElementById('manageSubscriptionBtn');

  if (saveBtn && !saveBtn.dataset.wiredSettingsSave) {
    saveBtn.dataset.wiredSettingsSave = '1';
    saveBtn.addEventListener('click', async () => {
      const settings = getSettingsInputs();
      const targets = getTargetsFromSettings(settings);
      const nextState = reconcileStateDay({
        ...state,
        settings,
        target: targets.target,
        calorieTarget: targets.calorieTarget,
      });

      await setState({
        settings: nextState.settings,
        target: nextState.target,
        calorieTarget: nextState.calorieTarget,
        logItems: nextState.logItems,
        history: nextState.history,
        dayStamp: nextState.dayStamp,
        streak: nextState.streak,
        totalP: nextState.totalP,
        totalC: nextState.totalC,
      });
      await syncReminders({
        requestPermission: settings.reminderEnabled,
        showToast: false,
      });

      populateGoalsForm();
      refreshAppView();
      scheduleAutomaticResetCheck();

      if (status) {
        status.textContent = t('settings.status.saved');
      }

      ui.showToastUI(t('toast.settingsSaved'));
    });
  }

  if (resetBtn && !resetBtn.dataset.wiredSettingsReset) {
    resetBtn.dataset.wiredSettingsReset = '1';
    resetBtn.addEventListener('click', async () => {
      const settings = createDefaultSettingsState();
      const targets = getTargetsFromSettings(settings);
      const nextState = reconcileStateDay({
        ...state,
        settings,
        target: targets.target,
        calorieTarget: targets.calorieTarget,
      });

      await setState({
        settings: nextState.settings,
        target: nextState.target,
        calorieTarget: nextState.calorieTarget,
        logItems: nextState.logItems,
        history: nextState.history,
        dayStamp: nextState.dayStamp,
        streak: nextState.streak,
        totalP: nextState.totalP,
        totalC: nextState.totalC,
      });
      await syncReminders({
        requestPermission: false,
        showToast: false,
      });

      populateSettingsForm();
      populateGoalsForm();
      refreshAppView();
      scheduleAutomaticResetCheck();

      if (status) {
        status.textContent = t('settings.status.reset');
      }

      ui.showToastUI(t('toast.settingsReset'));
    });
  }

  purchaseButtons.forEach((id) => {
    const button = document.getElementById(id);
    if (!button || button.dataset.wiredMembership) {
      return;
    }

    button.dataset.wiredMembership = '1';
    button.addEventListener('click', async () => {
      await handleMembershipPurchase();
    });
  });

  restoreButtons.forEach((id) => {
    const button = document.getElementById(id);
    if (!button || button.dataset.wiredMembership) {
      return;
    }

    button.dataset.wiredMembership = '1';
    button.addEventListener('click', async () => {
      await handleMembershipRestore();
    });
  });

  if (manageSubscriptionBtn && !manageSubscriptionBtn.dataset.wiredMembership) {
    manageSubscriptionBtn.dataset.wiredMembership = '1';
    manageSubscriptionBtn.addEventListener('click', () => {
      if (!accessSnapshot.managementUrl) {
        return;
      }

      window.open(accessSnapshot.managementUrl, '_blank', 'noopener');
    });
  }
}

async function initPWA() {
  const registration = await registerServiceWorker((worker) => {
    showUpdateBanner(worker);
  });

  setupInstallPrompt(
    document.getElementById('installBtn'),
    (message) => ui.showToastUI(message)
  );

  return registration;
}

function navigateToPreferredScreen(forceHome = false) {
  if (forceHome) {
    router.go('home');
    return;
  }

  const preferred = state.settings?.defaultScreen || 'home';
  router.go(preferred);
}

async function runStartupExperience() {
  const shouldShowIntro = state.settings?.launchIntro !== false;

  setLaunchState(t('launch.status.loadingData'), 18);
  applySettingsToUI();
  populateSettingsForm();
  populateGoalsForm();
  refreshAppView();
  await sleep(220);

  setLaunchState(t('launch.status.checkingUpdate'), 48);
  const registration = await initPWA();
  if (registration) {
    await registration.update().catch(() => {});
  }

  await sleep(280);

  if (waitingWorker) {
    setLaunchState(t('launch.status.applyingUpdate'), 88);
    sessionStorage.setItem(UPDATE_RELOAD_FLAG, '1');
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    return;
  }

  const updatedNow = sessionStorage.getItem(UPDATE_RELOAD_FLAG) === '1';
  if (updatedNow) {
    sessionStorage.removeItem(UPDATE_RELOAD_FLAG);
  }

  navigateToPreferredScreen(updatedNow);
  setLaunchState(updatedNow ? t('launch.status.updated') : t('launch.status.ready'), 100);

  if (!shouldShowIntro && !updatedNow) {
    finishLaunch();
    return;
  }

  await sleep(260);
  finishLaunch();
}

async function init() {
  wireNavigationDrawer();
  wireLanguagePicker();
  wireGoalDraftPersistence();
  wireResetControls();
  wireFoodPhotoScan();
  wireModalAdd();
  wireManualAdd();
  wireResetDay();
  wireAIGoals();
  wireSettings();
  scheduleAutomaticResetCheck();
  const accessRefreshPromise = refreshAccessControl({
    forceSync: true,
    persist: false,
  });
  await runStartupExperience();
  await accessRefreshPromise;
  refreshAppView();
  if (!accessSnapshot.locked) {
    await syncReminders({
      requestPermission: false,
      showToast: false,
    });
  }
}

function handleStartupFailure(error) {
  console.error('App startup failed.', error);

  state = {
    ...createDefaultState(),
    access: sanitizeAccessState(createDefaultAccessState()),
  };
  accessSnapshot = buildAccessSnapshot({
    accessState: state.access,
    billingStatus,
    freeAccessEnabled: isTemporaryFreeAccessEnabled(),
  });

  try {
    router.go('home');
    applySettingsToUI();
    populateSettingsForm();
    populateGoalsForm();
    refreshAppView();
  } catch (safeModeError) {
    console.error('Safe mode rendering failed.', safeModeError);
  }

  setLaunchState(t('launch.status.ready'), 100);
  finishLaunch();
}

init().catch(handleStartupFailure);
