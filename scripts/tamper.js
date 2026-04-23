import { deriveHmacKey } from './crypto.js';

const APP_SALT = 'protein-flow-tamper-v1';
const DEFAULT_STORAGE_KEY = 'protein-flow-state-v2';

export function getStorageIntegrityKeys(storageKey = DEFAULT_STORAGE_KEY) {
  return {
    dataKey: storageKey,
    hmacKey: `${storageKey}-hmac`,
    metadataKey: `${storageKey}-metadata`,
  };
}

export async function computeHmac(encryptedPayload, metadata, passphrase, extraSalt = '') {
  const salt = APP_SALT + extraSalt;
  const key = await deriveHmacKey(passphrase, salt);
  const enc = new TextEncoder();
  const data = enc.encode(encryptedPayload + metadata);
  const signature = await crypto.subtle.sign('HMAC', key, data);
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

export async function verifyStorage(
  passphrase,
  { extraSalt = '', metadata = '', storageKey = DEFAULT_STORAGE_KEY } = {}
) {
  const { dataKey, hmacKey } = getStorageIntegrityKeys(storageKey);
  const rawEncrypted = localStorage.getItem(dataKey);
  const rawHmac = localStorage.getItem(hmacKey);

  if (!rawEncrypted || !rawHmac || !metadata) return false;

  try {
    const isValid = await computeHmac(rawEncrypted, metadata, passphrase, extraSalt) === rawHmac;
    if (!isValid) {
      console.warn('Storage tamper detected!');
    }
    return isValid;
  } catch {
    return false;
  }
}

export function generateMetadata(version = '1.0.0') {
  return `${version}:${Date.now()}`;
}
