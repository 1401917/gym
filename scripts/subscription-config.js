export const SUBSCRIPTION_CONFIG = Object.freeze({
  temporaryFreeAccess: true,
  entitlementId: 'premium',
  offeringIdentifier: 'default',
  monthlyPriceLabel: '$9 / month',
  marketingTrialLabel: '30-day free trial for eligible new subscribers',
  androidApiKey: '',
  iosApiKey: '',
  earlyAccessPath: 'assets/early-access.json',
  privacyPolicyPath: 'legal/privacy.html',
  termsPath: 'legal/terms.html',
  supportEmail: 'support@example.com',
});

export function isTemporaryFreeAccessEnabled() {
  return SUBSCRIPTION_CONFIG.temporaryFreeAccess === true;
}

export function getBillingPlatform() {
  return globalThis.window?.Capacitor?.getPlatform?.() || globalThis.window?.Capacitor?.platform || 'web';
}

export function getRevenueCatApiKey(platform = getBillingPlatform()) {
  if (platform === 'android') {
    return SUBSCRIPTION_CONFIG.androidApiKey;
  }

  if (platform === 'ios') {
    return SUBSCRIPTION_CONFIG.iosApiKey;
  }

  return '';
}

export function isBillingConfigured(platform = getBillingPlatform()) {
  return Boolean(getRevenueCatApiKey(platform));
}

export function getLegalLinks() {
  return {
    privacy: SUBSCRIPTION_CONFIG.privacyPolicyPath,
    terms: SUBSCRIPTION_CONFIG.termsPath,
  };
}

export function getFallbackPackageMeta() {
  return {
    identifier: 'monthly',
    packageType: 'MONTHLY',
    productIdentifier: '',
    title: 'Premium access',
    description: 'Unlock the full nutrition tracker experience on this device.',
    price: 9,
    priceString: SUBSCRIPTION_CONFIG.monthlyPriceLabel,
    currencyCode: 'USD',
    trialLabel: SUBSCRIPTION_CONFIG.marketingTrialLabel,
    webCheckoutUrl: null,
  };
}
