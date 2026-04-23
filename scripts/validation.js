import { DEFAULT_LANGUAGE, LANGUAGE_OPTIONS } from './i18n.js';
import {
  DEFAULT_RESET_MODE,
  DEFAULT_RESET_TIME,
  normalizeResetMode,
  normalizeResetTime,
} from './day-reset.js';
import { normalizeReminderTime } from './reminders.js';

const INVALID_PATTERNS = /<script|javascript:|data:|vbscript:|on\w+=|expression\s*\(|\/\*|\*\//gi;
const SUPPORTED_LANGUAGES = new Set(LANGUAGE_OPTIONS.map((item) => item.code));

export function sanitizeString(str) {
  return String(str || '')
    .trim()
    .replace(INVALID_PATTERNS, '')
    .replace(/[<>"]/g, c => ({ '<': '<', '>': '>', '"': '"' }[c]));
}

function sanitizeLogItem(item) {
  return {
    name: sanitizeString(item.name || ''),
    nameKey: typeof item.nameKey === 'string' ? item.nameKey : '',
    protein: Math.max(0, Number(item.protein || 0)),
    calories: Math.max(0, Number(item.calories || 0)),
  };
}

export function validateLogItem(item) {
  const sanitized = sanitizeLogItem(item);
  if (!sanitized.name || sanitized.name.length > 100) {
    throw new Error('Invalid food name');
  }
  if (sanitized.protein > 1000) {
    throw new Error('Invalid protein (0-1000g)');
  }
  if (sanitized.calories > 10000) {
    throw new Error('Invalid calories (0-10000)');
  }
  return sanitized;
}

export function sanitizeSettings(settings) {
  const safe = { ...settings };
  safe.language = SUPPORTED_LANGUAGES.has(safe.language) ? safe.language : DEFAULT_LANGUAGE;
  safe.goalAge = String(Math.max(10, Math.min(100, Number(safe.goalAge) || 25)));
  safe.reminderEnabled = Boolean(safe.reminderEnabled);
  safe.reminderTime = normalizeReminderTime(safe.reminderTime);
  safe.resetMode = normalizeResetMode(safe.resetMode || DEFAULT_RESET_MODE);
  safe.resetTime = normalizeResetTime(safe.resetTime || DEFAULT_RESET_TIME);
  return safe;
}
