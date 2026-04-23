import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAccessSnapshot,
  createDefaultAccessState,
  normalizePhoneNumber,
  resolveEarlyAccess,
} from '../scripts/access.js';
import { isTemporaryFreeAccessEnabled } from '../scripts/subscription-config.js';

test('normalizePhoneNumber strips formatting and rejects short values', () => {
  assert.equal(normalizePhoneNumber('+972-50-123-4567'), '972501234567');
  assert.equal(normalizePhoneNumber('12345'), '');
});

test('resolveEarlyAccess matches normalized numbers from the JSON directory', () => {
  const result = resolveEarlyAccess(
    { phones: ['972501234567'] },
    '+972 50 123 4567'
  );

  assert.equal(result.matched, true);
  assert.equal(result.normalizedPhone, '972501234567');
});

test('buildAccessSnapshot unlocks the app for early access', () => {
  const snapshot = buildAccessSnapshot({
    accessState: {
      ...createDefaultAccessState(),
      phoneNumber: '972501234567',
    },
    earlyAccessResult: {
      matched: true,
      normalizedPhone: '972501234567',
      maskedPhone: '***4567',
    },
    billingStatus: {
      configured: false,
      status: 'not-configured',
    },
    freeAccessEnabled: false,
  });

  assert.equal(snapshot.granted, true);
  assert.equal(snapshot.source, 'early-access');
  assert.equal(snapshot.status, 'early-access');
});

test('buildAccessSnapshot recognizes a store trial entitlement', () => {
  const snapshot = buildAccessSnapshot({
    accessState: createDefaultAccessState(),
    earlyAccessResult: {
      matched: false,
      normalizedPhone: '',
      maskedPhone: '',
    },
    billingStatus: {
      configured: true,
      status: 'ready',
      entitlement: {
        isActive: true,
        periodType: 'TRIAL',
        expirationDate: '2026-04-25T00:00:00.000Z',
        willRenew: true,
        verification: 'VERIFIED',
        productIdentifier: 'proteinflow_premium_monthly',
      },
      managementUrl: 'https://example.com/manage',
    },
    freeAccessEnabled: false,
  });

  assert.equal(snapshot.granted, true);
  assert.equal(snapshot.source, 'trial');
  assert.equal(snapshot.status, 'trial');
});

test('buildAccessSnapshot locks the app when no unlock source exists', () => {
  const snapshot = buildAccessSnapshot({
    accessState: createDefaultAccessState(),
    earlyAccessResult: {
      matched: false,
      normalizedPhone: '',
      maskedPhone: '',
    },
    billingStatus: {
      configured: true,
      status: 'ready',
      entitlement: null,
    },
    freeAccessEnabled: false,
  });

  assert.equal(snapshot.granted, false);
  assert.equal(snapshot.status, 'locked');
});

test('buildAccessSnapshot unlocks the app when temporary free access is enabled', () => {
  const snapshot = buildAccessSnapshot({
    accessState: createDefaultAccessState(),
    earlyAccessResult: {
      matched: false,
      normalizedPhone: '',
      maskedPhone: '',
    },
    billingStatus: {
      configured: false,
      status: 'not-configured',
      entitlement: null,
    },
    freeAccessEnabled: true,
  });

  assert.equal(snapshot.granted, true);
  assert.equal(snapshot.locked, false);
  assert.equal(snapshot.source, 'early-access');
  assert.equal(snapshot.status, 'early-access');
  assert.equal(snapshot.billingConfigured, false);
  assert.equal(isTemporaryFreeAccessEnabled(), true);
});
