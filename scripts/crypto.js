const APP_SALT = 'protein-flow-salt-v1';
const PBKDF2_ITERATIONS = 100000;
const AES_KEY_LENGTH = 256;
const GCM_IV_LENGTH = 12;

async function importPassphraseKeyMaterial(passphrase) {
  const enc = new TextEncoder();

  return crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );
}

async function deriveCryptoKey(passphrase, salt, derivedKeyType, usages) {
  const enc = new TextEncoder();
  const keyMaterial = await importPassphraseKeyMaterial(passphrase);

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    keyMaterial,
    derivedKeyType,
    false,
    usages
  );
}

export async function deriveKey(passphrase, salt) {
  return deriveCryptoKey(
    passphrase,
    salt,
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    ['encrypt', 'decrypt']
  );
}

export async function deriveHmacKey(passphrase, salt) {
  return deriveCryptoKey(
    passphrase,
    salt,
    { name: 'HMAC', hash: 'SHA-256', length: AES_KEY_LENGTH },
    ['sign', 'verify']
  );
}

export async function encrypt(data, passphrase = null, extraSalt = '') {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto API not supported');
  }

  if (!passphrase) {
    throw new Error('Passphrase required for encryption');
  }

  const salt = APP_SALT + extraSalt;
  const key = await deriveKey(passphrase, salt);
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_LENGTH));
  const enc = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(JSON.stringify(data))
  );

  const combined = new Uint8Array(iv.byteLength + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.byteLength);
  return btoa(String.fromCharCode(...combined));
}

export async function decrypt(encryptedBase64, passphrase, extraSalt = '') {
  if (!globalThis.crypto?.subtle) return null;

  const salt = APP_SALT + extraSalt;
  const key = await deriveKey(passphrase, salt);

  try {
    const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
    const iv = combined.slice(0, GCM_IV_LENGTH);
    const data = combined.slice(GCM_IV_LENGTH);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      data
    );
    const dec = new TextDecoder();
    return JSON.parse(dec.decode(decrypted));
  } catch {
    return null;
  }
}

export function isCryptoSupported() {
  return !!globalThis.crypto?.subtle;
}

export async function clearStorage(storageKey = 'protein-flow-state-v2') {
  localStorage.removeItem(storageKey);
  localStorage.removeItem(`${storageKey}-hmac`);
  localStorage.removeItem(`${storageKey}-metadata`);
}
