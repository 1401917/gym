import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeSettings } from '../scripts/validation.js';

test('sanitizeSettings normalizes reminder fields', () => {
  const sanitized = sanitizeSettings({
    language: 'xx',
    goalAge: '180',
    reminderEnabled: 'yes',
    reminderTime: '99:77',
    resetMode: 'something',
    resetTime: '88:88',
  });

  assert.equal(sanitized.language, 'he');
  assert.equal(sanitized.goalAge, '100');
  assert.equal(sanitized.reminderEnabled, true);
  assert.equal(sanitized.reminderTime, '19:00');
  assert.equal(sanitized.resetMode, 'auto');
  assert.equal(sanitized.resetTime, '00:00');
});
