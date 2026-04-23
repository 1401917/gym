import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildReminderNotification,
  normalizeReminderTime,
} from '../scripts/reminders.js';

test('normalizeReminderTime keeps valid values and falls back on invalid ones', () => {
  assert.equal(normalizeReminderTime('08:30'), '08:30');
  assert.equal(normalizeReminderTime('25:10'), '19:00');
  assert.equal(normalizeReminderTime('abc'), '19:00');
});

test('buildReminderNotification creates a daily notification payload', () => {
  const notification = buildReminderNotification(
    { reminderTime: '18:45', proteinGoal: '160', calorieGoal: '2400' },
    { target: 160, calorieTarget: 2400 }
  );

  assert.equal(notification.id, 41001);
  assert.equal(notification.schedule.on.hour, 18);
  assert.equal(notification.schedule.on.minute, 45);
  assert.match(notification.body, /160g protein/);
});
