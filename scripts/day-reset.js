export const DEFAULT_RESET_MODE = 'auto';
export const DEFAULT_RESET_TIME = '00:00';

function padNumber(value) {
  return String(value).padStart(2, '0');
}

function toSafeDate(value = new Date()) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export function formatDayStamp(date = new Date()) {
  const safeDate = toSafeDate(date);
  return `${safeDate.getFullYear()}-${padNumber(safeDate.getMonth() + 1)}-${padNumber(safeDate.getDate())}`;
}

export function normalizeResetMode(value = DEFAULT_RESET_MODE) {
  return String(value || '').trim().toLowerCase() === 'manual' ? 'manual' : DEFAULT_RESET_MODE;
}

export function normalizeResetTime(value = DEFAULT_RESET_TIME) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) {
    return DEFAULT_RESET_TIME;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return DEFAULT_RESET_TIME;
  }

  return `${padNumber(hour)}:${padNumber(minute)}`;
}

export function isAutomaticResetEnabled(settings = {}) {
  return normalizeResetMode(settings.resetMode) === 'auto';
}

export function getAutomaticResetDayStamp(settings = {}, now = new Date()) {
  const safeDate = toSafeDate(now);
  const [hour, minute] = normalizeResetTime(settings.resetTime).split(':').map(Number);
  const adjustedDate = new Date(safeDate.getTime());

  if (
    safeDate.getHours() < hour
    || (safeDate.getHours() === hour && safeDate.getMinutes() < minute)
  ) {
    adjustedDate.setDate(adjustedDate.getDate() - 1);
  }

  return formatDayStamp(adjustedDate);
}

export function getCurrentTrackingDayStamp(settings = {}, now = new Date()) {
  return isAutomaticResetEnabled(settings)
    ? getAutomaticResetDayStamp(settings, now)
    : formatDayStamp(now);
}

export function getNextAutomaticResetDate(settings = {}, now = new Date()) {
  if (!isAutomaticResetEnabled(settings)) {
    return null;
  }

  const safeDate = toSafeDate(now);
  const [hour, minute] = normalizeResetTime(settings.resetTime).split(':').map(Number);
  const nextReset = new Date(safeDate.getTime());
  nextReset.setHours(hour, minute, 0, 0);

  if (nextReset <= safeDate) {
    nextReset.setDate(nextReset.getDate() + 1);
  }

  return nextReset;
}
