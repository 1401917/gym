import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatDayStamp,
  getCurrentTrackingDayStamp,
  getNextAutomaticResetDate,
  isAutomaticResetEnabled,
  normalizeResetMode,
  normalizeResetTime,
} from '../scripts/day-reset.js';

test('normalize reset settings keeps safe defaults', () => {
  assert.equal(normalizeResetMode('manual'), 'manual');
  assert.equal(normalizeResetMode('weird-value'), 'auto');
  assert.equal(normalizeResetTime('4:05'), '04:05');
  assert.equal(normalizeResetTime('25:10'), '00:00');
});

test('automatic reset can keep early-morning logs on the previous tracking day', () => {
  const settings = {
    resetMode: 'auto',
    resetTime: '04:00',
  };

  assert.equal(
    getCurrentTrackingDayStamp(settings, new Date('2026-03-25T03:45:00')),
    '2026-03-24'
  );
  assert.equal(
    getCurrentTrackingDayStamp(settings, new Date('2026-03-25T04:00:00')),
    '2026-03-25'
  );
});

test('manual reset mode always follows the calendar day', () => {
  const settings = {
    resetMode: 'manual',
    resetTime: '04:00',
  };

  assert.equal(isAutomaticResetEnabled(settings), false);
  assert.equal(
    getCurrentTrackingDayStamp(settings, new Date('2026-03-25T03:45:00')),
    '2026-03-25'
  );
});

test('next automatic reset is scheduled for the upcoming reset boundary', () => {
  const settings = {
    resetMode: 'auto',
    resetTime: '04:00',
  };

  assert.equal(
    formatDayStamp(getNextAutomaticResetDate(settings, new Date('2026-03-25T03:45:00'))),
    '2026-03-25'
  );
  assert.equal(
    getNextAutomaticResetDate(settings, new Date('2026-03-25T03:45:00')).toISOString(),
    new Date('2026-03-25T04:00:00').toISOString()
  );
  assert.equal(
    getNextAutomaticResetDate(settings, new Date('2026-03-25T05:15:00')).toISOString(),
    new Date('2026-03-26T04:00:00').toISOString()
  );
});
