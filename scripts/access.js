import { SUBSCRIPTION_CONFIG, getFallbackPackageMeta, isTemporaryFreeAccessEnabled } from './subscription-config.js';

const ACCESS_STATUSES = new Set([
  'checking',
  'locked',
  'active',
  'trial',
  'early-access',
  'unconfigured',
  'unsupported',
  'error',
]);

const ACCESS_SOURCES = new Set([
  'none',
  'subscription',
  'trial',
  'early-access',
]);
const INSTALLATION_ID_STORAGE_KEY = 'protein-flow-installation-id';

function createInstallationId() {
  if (globalThis.crypto?.randomUUID) {
    return `pf-${crypto.randomUUID()}`;
  }

  return `pf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getPersistentInstallationId() {
  try {
    const existingId = globalThis.localStorage?.getItem(INSTALLATION_ID_STORAGE_KEY);
    if (existingId) {
      return existingId;
    }

    const nextId = createInstallationId();
    globalThis.localStorage?.setItem(INSTALLATION_ID_STORAGE_KEY, nextId);
    return nextId;
  } catch {
    return createInstallationId();
  }
}

function normalizeIsoTimestamp(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function sanitizeString(value, maxLength = 240) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().slice(0, maxLength);
}

function getSingularUnit(unit) {
  const normalized = String(unit || '').toUpperCase();
  if (normalized === 'DAY') return 'day';
  if (normalized === 'WEEK') return 'week';
  if (normalized === 'MONTH') return 'month';
  if (normalized === 'YEAR') return 'year';
  return '';
}

export function normalizePhoneNumber(value = '') {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) {
    return '';
  }

  return digits;
}

export function maskPhoneNumber(value = '') {
  const normalized = normalizePhoneNumber(value);
  if (!normalized) {
    return '';
  }

  const lastFour = normalized.slice(-4);
  return `***${lastFour}`;
}

export function createDefaultAccessState() {
  return {
    installationId: getPersistentInstallationId(),
    phoneNumber: '',
    status: 'checking',
    unlockSource: 'none',
    lastCheckedAt: null,
    lastBillingSyncAt: null,
    billingConfigured: false,
    expiresAt: null,
    managementUrl: '',
    verification: 'NOT_REQUESTED',
    lastBillingError: '',
    productIdentifier: '',
    periodType: '',
    willRenew: false,
  };
}

export function sanitizeAccessState(rawState = {}) {
  const defaults = createDefaultAccessState();
  const safeState = rawState && typeof rawState === 'object' ? rawState : {};
  const normalizedStatus = ACCESS_STATUSES.has(safeState.status) ? safeState.status : defaults.status;
  const normalizedSource = ACCESS_SOURCES.has(safeState.unlockSource) ? safeState.unlockSource : defaults.unlockSource;

  return {
    installationId: sanitizeString(safeState.installationId, 96) || defaults.installationId,
    phoneNumber: normalizePhoneNumber(safeState.phoneNumber),
    status: normalizedStatus,
    unlockSource: normalizedSource,
    lastCheckedAt: normalizeIsoTimestamp(safeState.lastCheckedAt),
    lastBillingSyncAt: normalizeIsoTimestamp(safeState.lastBillingSyncAt),
    billingConfigured: Boolean(safeState.billingConfigured),
    expiresAt: normalizeIsoTimestamp(safeState.expiresAt),
    managementUrl: sanitizeString(safeState.managementUrl, 512),
    verification: sanitizeString(safeState.verification, 48) || defaults.verification,
    lastBillingError: sanitizeString(safeState.lastBillingError, 240),
    productIdentifier: sanitizeString(safeState.productIdentifier, 160),
    periodType: sanitizeString(safeState.periodType, 32),
    willRenew: Boolean(safeState.willRenew),
  };
}

function describeDuration(unit, value) {
  const singularUnit = getSingularUnit(unit);
  const numericValue = Number(value);

  if (!singularUnit || !Number.isFinite(numericValue) || numericValue <= 0) {
    return '';
  }

  return numericValue === 1 ? `1 ${singularUnit}` : `${numericValue} ${singularUnit}s`;
}

function getTrialLabelFromIntroPrice(introPrice) {
  if (!introPrice) {
    return '';
  }

  const duration = describeDuration(introPrice.periodUnit, introPrice.periodNumberOfUnits);
  if (!duration) {
    return '';
  }

  if (Number(introPrice.price || 0) === 0) {
    return `${duration} free trial`;
  }

  return `${introPrice.priceString} for ${duration}`;
}

function getTrialLabelFromSubscriptionOption(subscriptionOption) {
  const freePhase = subscriptionOption?.freePhase;
  if (!freePhase?.billingPeriod) {
    return '';
  }

  const duration = describeDuration(freePhase.billingPeriod.unit, freePhase.billingPeriod.value);
  return duration ? `${duration} free trial` : '';
}

export function extractPackageOfferMeta(aPackage) {
  if (!aPackage || typeof aPackage !== 'object') {
    return getFallbackPackageMeta();
  }

  const product = aPackage.product || {};
  const subscriptionOptions = Array.isArray(product.subscriptionOptions) ? product.subscriptionOptions : [];
  const trialLabel = getTrialLabelFromIntroPrice(product.introPrice)
    || getTrialLabelFromSubscriptionOption(product.defaultOption)
    || subscriptionOptions.map(getTrialLabelFromSubscriptionOption).find(Boolean)
    || SUBSCRIPTION_CONFIG.marketingTrialLabel;

  return {
    identifier: String(aPackage.identifier || 'monthly'),
    packageType: String(aPackage.packageType || 'MONTHLY'),
    productIdentifier: String(product.identifier || ''),
    title: String(product.title || 'Premium access'),
    description: String(product.description || ''),
    price: Number(product.price || 0),
    priceString: String(product.priceString || SUBSCRIPTION_CONFIG.monthlyPriceLabel),
    currencyCode: String(product.currencyCode || 'USD'),
    trialLabel,
    webCheckoutUrl: aPackage.webCheckoutUrl || null,
  };
}

export async function loadEarlyAccessDirectory(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') {
    return {
      updatedAt: null,
      phones: [],
    };
  }

  try {
    const response = await fetchImpl(`${SUBSCRIPTION_CONFIG.earlyAccessPath}?ts=${Date.now()}`, {
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`Unable to load early access file (${response.status})`);
    }

    const payload = await response.json();
    const phones = Array.isArray(payload?.phones) ? payload.phones.map(normalizePhoneNumber).filter(Boolean) : [];

    return {
      updatedAt: normalizeIsoTimestamp(payload?.updatedAt),
      phones,
    };
  } catch {
    return {
      updatedAt: null,
      phones: [],
    };
  }
}

export function resolveEarlyAccess(directory, phoneNumber) {
  const normalizedPhone = normalizePhoneNumber(phoneNumber);
  const allowlist = new Set((directory?.phones || []).map(normalizePhoneNumber).filter(Boolean));

  return {
    matched: Boolean(normalizedPhone && allowlist.has(normalizedPhone)),
    normalizedPhone,
    maskedPhone: maskPhoneNumber(normalizedPhone),
  };
}

export function buildAccessSnapshot({
  accessState = {},
  earlyAccessResult = { matched: false, normalizedPhone: '', maskedPhone: '' },
  billingStatus = {},
  freeAccessEnabled = isTemporaryFreeAccessEnabled(),
} = {}) {
  const normalizedAccess = sanitizeAccessState(accessState);
  const packageMeta = billingStatus.package || getFallbackPackageMeta();
  const entitlement = billingStatus.entitlement || null;
  const entitlementPeriodType = sanitizeString(entitlement?.periodType || '').toUpperCase();

  if (freeAccessEnabled) {
    return {
      granted: true,
      locked: false,
      source: 'early-access',
      status: 'early-access',
      phoneMask: '',
      expiresAt: null,
      managementUrl: '',
      verification: 'NOT_REQUESTED',
      billingConfigured: false,
      productIdentifier: '',
      periodType: '',
      willRenew: false,
      package: packageMeta,
      errorMessage: '',
    };
  }

  if (earlyAccessResult?.matched) {
    return {
      granted: true,
      locked: false,
      source: 'early-access',
      status: 'early-access',
      phoneMask: earlyAccessResult.maskedPhone || maskPhoneNumber(normalizedAccess.phoneNumber),
      expiresAt: null,
      managementUrl: '',
      verification: 'NOT_REQUESTED',
      billingConfigured: Boolean(billingStatus.configured),
      productIdentifier: '',
      periodType: '',
      willRenew: false,
      package: packageMeta,
      errorMessage: '',
    };
  }

  if (entitlement?.isActive) {
    const source = entitlementPeriodType === 'TRIAL' ? 'trial' : 'subscription';
    const status = source === 'trial' ? 'trial' : 'active';

    return {
      granted: true,
      locked: false,
      source,
      status,
      phoneMask: '',
      expiresAt: entitlement.expirationDate || null,
      managementUrl: billingStatus.managementUrl || '',
      verification: entitlement.verification || billingStatus.verification || 'NOT_REQUESTED',
      billingConfigured: Boolean(billingStatus.configured),
      productIdentifier: entitlement.productIdentifier || '',
      periodType: entitlementPeriodType,
      willRenew: Boolean(entitlement.willRenew),
      package: packageMeta,
      errorMessage: billingStatus.errorMessage || '',
    };
  }

  let status = 'locked';
  if (billingStatus.status === 'checking') status = 'checking';
  if (billingStatus.status === 'unsupported') status = 'unsupported';
  if (billingStatus.status === 'not-configured' || billingStatus.status === 'offering-missing') status = 'unconfigured';
  if (billingStatus.status === 'error') status = 'error';

  return {
    granted: false,
    locked: true,
    source: 'none',
    status,
    phoneMask: '',
    expiresAt: null,
    managementUrl: '',
    verification: billingStatus.verification || normalizedAccess.verification || 'NOT_REQUESTED',
    billingConfigured: Boolean(billingStatus.configured),
    productIdentifier: '',
    periodType: '',
    willRenew: false,
    package: packageMeta,
    errorMessage: billingStatus.errorMessage || '',
  };
}

export function buildStoredAccessState(previousState, snapshot, overrides = {}) {
  return sanitizeAccessState({
    ...previousState,
    ...overrides,
    status: snapshot.status,
    unlockSource: snapshot.source,
    lastCheckedAt: new Date().toISOString(),
    lastBillingSyncAt: new Date().toISOString(),
    billingConfigured: snapshot.billingConfigured,
    expiresAt: snapshot.expiresAt,
    managementUrl: snapshot.managementUrl,
    verification: snapshot.verification,
    lastBillingError: snapshot.errorMessage || '',
    productIdentifier: snapshot.productIdentifier,
    periodType: snapshot.periodType,
    willRenew: snapshot.willRenew,
  });
}
