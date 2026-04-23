import { t } from './i18n.js';

let installPromptController = null;
let serviceWorkerLifecycleController = null;

function isNativeCapacitorPlatform() {
  const capacitor = globalThis.window?.Capacitor || globalThis.Capacitor || null;
  if (!capacitor) {
    return false;
  }

  if (typeof capacitor.isNativePlatform === 'function') {
    return capacitor.isNativePlatform();
  }

  const platform = capacitor.getPlatform?.() || capacitor.platform || 'web';
  return platform === 'android' || platform === 'ios';
}

export function setupInstallPrompt(button, showToast) {
  if (!button) return;

  installPromptController?.abort();
  installPromptController = typeof AbortController === 'function'
    ? new AbortController()
    : null;

  let deferredPrompt = null;
  const listenerOptions = installPromptController
    ? { signal: installPromptController.signal }
    : undefined;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    button.hidden = false;
  }, listenerOptions);

  button.addEventListener('click', async () => {
    if (!deferredPrompt) {
      showToast(t('install.unavailable'));
      return;
    }

    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    button.hidden = true;
  }, listenerOptions);
}

export async function registerServiceWorker(onUpdateReady) {
  if (!('serviceWorker' in navigator)) return null;

  if (isNativeCapacitorPlatform()) {
    const registrations = await navigator.serviceWorker.getRegistrations().catch(() => []);
    await Promise.all(registrations.map((registration) => registration.unregister().catch(() => false)));
    return null;
  }

  serviceWorkerLifecycleController?.abort();
  serviceWorkerLifecycleController = typeof AbortController === 'function'
    ? new AbortController()
    : null;

  let refreshing = false;
  const listenerOptions = serviceWorkerLifecycleController
    ? { signal: serviceWorkerLifecycleController.signal }
    : undefined;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  }, listenerOptions);

  try {
    const registration = await navigator.serviceWorker.register('sw.js');

    if (registration.waiting) {
      onUpdateReady?.(registration.waiting);
    }

    registration.addEventListener('updatefound', () => {
      const incoming = registration.installing;
      if (!incoming) return;

      incoming.addEventListener('statechange', () => {
        if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
          onUpdateReady?.(incoming);
        }
      }, listenerOptions);
    }, listenerOptions);

    return registration;
  } catch {
    return null;
  }
}
