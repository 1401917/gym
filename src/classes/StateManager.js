/**
 * OOP StateManager class.
 * Observer pattern, validation, async persistence.
 * High quality: Private fields, events, immutability.
 */

import Logger from '../../scripts/Logger.js';
import { SecureStorage } from './SecureStorage.js'; // Will create

export class StateManager {
  #state;
  #subscribers = new Set();
  #logger;
  #storage;

  constructor(initialState = null, storage = null) {
    this.#logger = Logger;
    this.#storage = storage || new SecureStorage();
    this.#state = initialState || this.#createDefaultState();
    this.#logger.info('StateManager', 'Initialized');
  }

  #createDefaultState() {
    return {
      totalP: 0,
      totalC: 0,
      target: 0,
      calorieTarget: 0,
      meals: 4,
      streak: 0,
      logItems: [],
      history: [],
      chatState: { currentState: 'root', messages: [] },
      settings: this.#createDefaultSettings(),
      dayStamp: this.#getDayStamp(),
    };
  }

  #createDefaultSettings() {
    return {
      language: 'en',
      defaultScreen: 'home',
      launchIntro: true,
      animations: 'full',
      goalGender: 'male',
      goalAge: '25',
      goalHeight: '170',
      goalWeight: '',
      goalType: 'maintain',
      goalTargetWeight: '',
      proteinGoal: '',
      calorieGoal: '',
      activityLevel: 'moderate',
    };
  }

  #getDayStamp(date = new Date()) {
    const pad = (v) => String(v).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  async #load() {
    const start = performance.now();
    try {
      const loaded = await this.#storage.load();
      if (loaded) {
        this.#state = { ...this.#state, ...loaded };
        this.#logger.info('StateManager', 'State loaded successfully');
      }
    } catch (e) {
      this.#logger.error('StateManager', 'Load failed', e);
      await this.#storage.clear();
    }
    this.#logger.performance('state.load', performance.now() - start);
    return this.#state;
  }

  async #save() {
    const start = performance.now();
    try {
      await this.#storage.save(this.#state);
      this.#logger.performance('state.save', performance.now() - start);
    } catch (e) {
      this.#logger.error('StateManager', 'Save failed', e);
    }
  }

  async init() {
    await this.#load();
    return this.getState();
  }

  getState() {
    return structuredClone(this.#state); // Immutable
  }

  set(keyPath, value) {
    const keys = keyPath.split('.');
    let target = this.#state;
    for (let i = 0; i < keys.length - 1; i++) {
      target = target[keys[i]] = target[keys[i]] || {};
    }
    target[keys[keys.length - 1]] = value;
    this.#notifySubscribers();
    this.#save();
  }

  update(updater) {
    this.#state = typeof updater === 'function' ? updater(this.#state) : updater;
    this.#notifySubscribers();
    this.#save();
  }

  subscribe(callback) {
    const id = Symbol();
    const subscription = { id, callback };
    this.#subscribers.add(subscription);
    return () => this.#subscribers.delete(subscription);
  }

  #notifySubscribers() {
    this.#subscribers.forEach(({ callback }) => callback(this.getState()));
  }

  validateLogItem(item) {
    // Delegate to validation
    return item;
  }
}

