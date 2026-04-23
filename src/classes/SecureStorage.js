import { encrypt, decrypt, isCryptoSupported } from '../../scripts/crypto.js';
import {
  computeHmac,
  verifyStorage,
  generateMetadata,
  getStorageIntegrityKeys,
} from '../../scripts/tamper.js';
import Logger from '../../scripts/Logger.js';

export class SecureStorage {
  constructor(storageKey = 'protein-flow-state-v2') {
    this.storageKey = storageKey;
    this.integrityKeys = getStorageIntegrityKeys(storageKey);
    this.autoPassphraseKey = `${storageKey}-device-secret`;
    this.cachedPassphrase = null;
    this.logger = Logger;
  }

  #generateAutomaticPassphrase() {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return `${this.storageKey}:${globalThis.crypto.randomUUID()}`;
    }

    if (typeof globalThis.crypto?.getRandomValues === 'function') {
      const randomBytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
      const randomHex = [...randomBytes].map((value) => value.toString(16).padStart(2, '0')).join('');
      return `${this.storageKey}:${randomHex}`;
    }

    return `${this.storageKey}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  }

  #resolvePassphrase() {
    if (this.cachedPassphrase) {
      return this.cachedPassphrase;
    }

    const storedPassphrase = localStorage.getItem(this.autoPassphraseKey);
    if (storedPassphrase) {
      this.cachedPassphrase = storedPassphrase;
      return storedPassphrase;
    }

    const automaticPassphrase = this.#generateAutomaticPassphrase();
    if (!automaticPassphrase) {
      return null;
    }

    try {
      localStorage.setItem(this.autoPassphraseKey, automaticPassphrase);
      this.cachedPassphrase = automaticPassphrase;
      return automaticPassphrase;
    } catch {
      return null;
    }
  }

  async save(state) {
    const passphrase = this.#resolvePassphrase();

    if (!passphrase) {
      this.logger.warn('SecureStorage', 'Automatic storage key unavailable, fallback to plain');
      localStorage.setItem(this.storageKey, JSON.stringify(state));
      localStorage.removeItem(this.integrityKeys.hmacKey);
      localStorage.removeItem(this.integrityKeys.metadataKey);
      this.cachedPassphrase = null;
      return;
    }

    if (isCryptoSupported()) {
      const metadata = generateMetadata();
      const encrypted = await encrypt(state, passphrase);
      const hmac = await computeHmac(encrypted, metadata, passphrase);
      localStorage.setItem(this.storageKey, encrypted);
      localStorage.setItem(this.integrityKeys.hmacKey, hmac);
      localStorage.setItem(this.integrityKeys.metadataKey, metadata);
      this.cachedPassphrase = passphrase;
    } else {
      localStorage.setItem(this.storageKey, JSON.stringify(state));
      localStorage.removeItem(this.integrityKeys.hmacKey);
      localStorage.removeItem(this.integrityKeys.metadataKey);
    }
  }

  async load() {
    const raw = localStorage.getItem(this.storageKey);
    if (!raw) return null;

    const rawHmac = localStorage.getItem(this.integrityKeys.hmacKey);
    if (!rawHmac) {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }

    const passphrase = this.#resolvePassphrase();
    if (!passphrase) return null;

    if (isCryptoSupported()) {
      const metadata = localStorage.getItem(this.integrityKeys.metadataKey);
      if (metadata) {
        const valid = await verifyStorage(passphrase, {
          metadata,
          storageKey: this.storageKey,
        });
        if (!valid) {
          this.logger.error('SecureStorage', 'Tamper detected');
          return null;
        }
      } else {
        this.logger.warn('SecureStorage', 'Metadata missing, attempting legacy decrypt');
      }

      const decrypted = await decrypt(raw, passphrase);
      if (!decrypted) {
        this.logger.error('SecureStorage', 'Decrypt failed');
        return null;
      }

      this.cachedPassphrase = passphrase;
      return decrypted;
    }

    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async clear() {
    this.cachedPassphrase = null;
    localStorage.removeItem(this.storageKey);
    localStorage.removeItem(this.integrityKeys.hmacKey);
    localStorage.removeItem(this.integrityKeys.metadataKey);
    localStorage.removeItem(this.autoPassphraseKey);
  }
}
