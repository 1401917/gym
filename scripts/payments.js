import { extractPackageOfferMeta } from './access.js';
import {
  getBillingPlatform,
  getFallbackPackageMeta,
  getRevenueCatApiKey,
} from './subscription-config.js';

const PURCHASES_PLUGIN_NAME = 'Purchases';
const LOG_LEVEL = Object.freeze({
  WARN: 'WARN',
});
const PACKAGE_TYPE = Object.freeze({
  MONTHLY: 'MONTHLY',
});
const ENTITLEMENT_VERIFICATION_MODE = Object.freeze({
  INFORMATIONAL: 'INFORMATIONAL',
});

let configurationPromise = null;
let purchasesPlugin = null;

function isNativeBillingPlatform(platform = getBillingPlatform()) {
  return platform === 'android' || platform === 'ios';
}

function getCapacitorBridge() {
  return globalThis.window?.Capacitor || globalThis.Capacitor || null;
}

function getPurchasesPlugin() {
  if (purchasesPlugin) {
    return purchasesPlugin;
  }

  const capacitor = getCapacitorBridge();
  if (!capacitor) {
    return null;
  }

  if (capacitor.Plugins?.[PURCHASES_PLUGIN_NAME]) {
    purchasesPlugin = capacitor.Plugins[PURCHASES_PLUGIN_NAME];
    return purchasesPlugin;
  }

  if (typeof capacitor.registerPlugin === 'function') {
    try {
      purchasesPlugin = capacitor.registerPlugin(PURCHASES_PLUGIN_NAME);
      return purchasesPlugin;
    } catch {
      return null;
    }
  }

  return null;
}

function getEntitlement(customerInfo, entitlementId) {
  return customerInfo?.entitlements?.active?.[entitlementId]
    || customerInfo?.entitlements?.all?.[entitlementId]
    || null;
}

function getSelectedOffering(offerings, offeringIdentifier) {
  if (!offerings) {
    return null;
  }

  return offerings.current || offerings.all?.[offeringIdentifier] || null;
}

function getPreferredPackage(offering) {
  if (!offering) {
    return null;
  }

  return offering.monthly
    || offering.availablePackages?.find((candidate) => candidate.packageType === PACKAGE_TYPE.MONTHLY)
    || offering.availablePackages?.[0]
    || null;
}

function buildBillingState({
  platform,
  configured = false,
  status,
  entitlementId,
  offeringIdentifier = '',
  offerings = null,
  customerInfo = null,
  errorMessage = '',
}) {
  const selectedOffering = getSelectedOffering(offerings, offeringIdentifier);
  const selectedPackage = getPreferredPackage(selectedOffering);
  const entitlement = getEntitlement(customerInfo, entitlementId);

  return {
    ok: status === 'ready',
    configured,
    platform,
    status,
    offeringIdentifier: selectedOffering?.identifier || '',
    package: selectedPackage ? extractPackageOfferMeta(selectedPackage) : getFallbackPackageMeta(),
    customerInfo,
    entitlement,
    managementUrl: customerInfo?.managementURL || '',
    verification: entitlement?.verification || customerInfo?.entitlements?.verification || 'NOT_REQUESTED',
    errorMessage,
  };
}

async function ensureConfigured(accessState, config) {
  const platform = getBillingPlatform();
  if (!isNativeBillingPlatform(platform)) {
    return {
      ok: false,
      configured: false,
      platform,
      status: 'unsupported',
    };
  }

  const plugin = getPurchasesPlugin();
  if (!plugin) {
    return {
      ok: false,
      configured: false,
      platform,
      status: 'unsupported',
    };
  }

  const apiKey = getRevenueCatApiKey(platform);
  if (!apiKey) {
    return {
      ok: false,
      configured: false,
      platform,
      status: 'not-configured',
    };
  }

  if (!configurationPromise) {
    configurationPromise = (async () => {
      const currentConfiguration = await plugin.isConfigured().catch(() => ({ isConfigured: false }));
      if (!currentConfiguration.isConfigured) {
        await plugin.configure({
          apiKey,
          appUserID: accessState.installationId,
          entitlementVerificationMode: ENTITLEMENT_VERIFICATION_MODE.INFORMATIONAL,
          shouldShowInAppMessagesAutomatically: true,
          diagnosticsEnabled: false,
        });
        await plugin.setLogLevel({ level: LOG_LEVEL.WARN }).catch(() => {});
        return;
      }

      const currentUser = await plugin.getAppUserID().catch(() => ({ appUserID: '' }));
      if (currentUser.appUserID !== accessState.installationId) {
        await plugin.logIn({ appUserID: accessState.installationId });
      }
    })().catch((error) => {
      configurationPromise = null;
      throw error;
    });
  }

  await configurationPromise;

  return {
    ok: true,
    configured: true,
    platform,
    status: 'configured',
    entitlementId: config.entitlementId,
  };
}

async function readBillingState(config, customerInfoOverride = null, forceSync = false) {
  const plugin = getPurchasesPlugin();
  if (!plugin) {
    return buildBillingState({
      platform: getBillingPlatform(),
      configured: false,
      status: 'unsupported',
      entitlementId: config.entitlementId,
      offeringIdentifier: config.offeringIdentifier,
    });
  }

  if (forceSync) {
    await plugin.syncPurchases().catch(() => {});
  }

  const [offerings, customerInfoResponse] = await Promise.all([
    plugin.getOfferings().catch(() => null),
    customerInfoOverride
      ? Promise.resolve({ customerInfo: customerInfoOverride })
      : plugin.getCustomerInfo().catch(() => null),
  ]);

  const customerInfo = customerInfoResponse?.customerInfo || customerInfoOverride || null;
  const selectedOffering = getSelectedOffering(offerings, config.offeringIdentifier);
  const hasOffer = Boolean(getPreferredPackage(selectedOffering));

  return buildBillingState({
    platform: getBillingPlatform(),
    configured: true,
    status: hasOffer ? 'ready' : 'offering-missing',
    entitlementId: config.entitlementId,
    offeringIdentifier: config.offeringIdentifier,
    offerings,
    customerInfo,
  });
}

export async function fetchBillingState(accessState, config, { forceSync = false } = {}) {
  const platform = getBillingPlatform();

  try {
    const configurationState = await ensureConfigured(accessState, config);
    if (!configurationState.ok) {
      return buildBillingState({
        platform,
        configured: false,
        status: configurationState.status,
        entitlementId: config.entitlementId,
        offeringIdentifier: config.offeringIdentifier,
      });
    }

    return await readBillingState(config, null, forceSync);
  } catch (error) {
    return buildBillingState({
      platform,
      configured: true,
      status: 'error',
      entitlementId: config.entitlementId,
      offeringIdentifier: config.offeringIdentifier,
      errorMessage: error?.message || 'Billing state could not be loaded.',
    });
  }
}

export async function purchaseMonthlySubscription(accessState, config) {
  const platform = getBillingPlatform();
  const plugin = getPurchasesPlugin();

  try {
    const configurationState = await ensureConfigured(accessState, config);
    if (!configurationState.ok) {
      return buildBillingState({
        platform,
        configured: false,
        status: configurationState.status,
        entitlementId: config.entitlementId,
        offeringIdentifier: config.offeringIdentifier,
      });
    }

    if (!plugin) {
      return buildBillingState({
        platform,
        configured: false,
        status: 'unsupported',
        entitlementId: config.entitlementId,
        offeringIdentifier: config.offeringIdentifier,
      });
    }

    const offerings = await plugin.getOfferings().catch(() => null);
    const selectedOffering = getSelectedOffering(offerings, config.offeringIdentifier);
    const selectedPackage = getPreferredPackage(selectedOffering);

    if (!selectedPackage) {
      return buildBillingState({
        platform,
        configured: true,
        status: 'offering-missing',
        entitlementId: config.entitlementId,
        offeringIdentifier: config.offeringIdentifier,
      });
    }

    const result = await plugin.purchasePackage({
      aPackage: selectedPackage,
    });

    return await readBillingState(config, result.customerInfo, false);
  } catch (error) {
    if (error?.userCancelled) {
      return buildBillingState({
        platform,
        configured: true,
        status: 'cancelled',
        entitlementId: config.entitlementId,
        offeringIdentifier: config.offeringIdentifier,
      });
    }

    return buildBillingState({
      platform,
      configured: true,
      status: 'error',
      entitlementId: config.entitlementId,
      offeringIdentifier: config.offeringIdentifier,
      errorMessage: error?.message || 'The purchase could not be completed.',
    });
  }
}

export async function restoreBillingPurchases(accessState, config) {
  const platform = getBillingPlatform();
  const plugin = getPurchasesPlugin();

  try {
    const configurationState = await ensureConfigured(accessState, config);
    if (!configurationState.ok) {
      return buildBillingState({
        platform,
        configured: false,
        status: configurationState.status,
        entitlementId: config.entitlementId,
        offeringIdentifier: config.offeringIdentifier,
      });
    }

    if (!plugin) {
      return buildBillingState({
        platform,
        configured: false,
        status: 'unsupported',
        entitlementId: config.entitlementId,
        offeringIdentifier: config.offeringIdentifier,
      });
    }

    const result = await plugin.restorePurchases();
    return await readBillingState(config, result.customerInfo, false);
  } catch (error) {
    return buildBillingState({
      platform,
      configured: true,
      status: 'error',
      entitlementId: config.entitlementId,
      offeringIdentifier: config.offeringIdentifier,
      errorMessage: error?.message || 'Purchases could not be restored.',
    });
  }
}
