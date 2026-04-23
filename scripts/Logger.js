/**
 * OOP Logger class with levels, localStorage persistence, timestamps.
 * High quality: Singleton pattern, fluent API.
 */

class Logger {
  static #instance = null;
  static #storageKey = 'app-logs-v1';

  constructor() {
    if (Logger.#instance) return Logger.#instance;
    Logger.#instance = this;
    this.levels = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
    this.currentLevel = this.levels.INFO;
    this.maxLogs = 500;
    this.logs = this.#loadLogs();
    this.consoleMethods = {
      log: console.log.bind(console),
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
    };
    this.consolePatched = false;
    this.#attachConsoleOverride();
  }

  static getInstance() {
    return new Logger();
  }

  #loadLogs() {
    try {
      const raw = localStorage.getItem(Logger.#storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.slice(-this.maxLogs) : [];
      }
    } catch {
      // Ignore
    }
    return [];
  }

  #saveLogs() {
    try {
      localStorage.setItem(Logger.#storageKey, JSON.stringify(this.logs));
    } catch {
      // Ignore storage errors
    }
  }

  #getConsoleMethod(level) {
    if (level === this.levels.ERROR) return this.consoleMethods.error;
    if (level === this.levels.WARN) return this.consoleMethods.warn;
    return this.consoleMethods.info;
  }

  #log(level, namespace, message, meta = null) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      level,
      namespace,
      message,
      meta,
      timestamp,
    };
    this.logs.push(logEntry);
    this.logs = this.logs.slice(-this.maxLogs);
    this.#saveLogs();

    if (level >= this.currentLevel) {
      const color = level === this.levels.ERROR ? '%c[ERROR]' : level === this.levels.WARN ? '%c[WARN]' : '%c[INFO]';
      const consoleMethod = this.#getConsoleMethod(level);
      consoleMethod(color, 'color: #ef4444', namespace, message, meta || '');
    }
  }

  #attachConsoleOverride() {
    if (this.consolePatched) {
      return;
    }

    const originalLog = this.consoleMethods.log;
    console.log = (...args) => {
      this.#log(this.levels.INFO, 'APP', args.map((arg) => String(arg)).join(' '));
      originalLog(...args);
    };

    this.consolePatched = true;
  }

  setLevel(level) {
    this.currentLevel = this.levels[level.toUpperCase()] || this.levels.INFO;
    return this;
  }

  debug(namespace, message, meta) {
    this.#log(this.levels.DEBUG, namespace, message, meta);
    return this;
  }

  info(namespace, message, meta) {
    this.#log(this.levels.INFO, namespace, message, meta);
    return this;
  }

  warn(namespace, message, meta) {
    this.#log(this.levels.WARN, namespace, message, meta);
    return this;
  }

  error(namespace, message, meta) {
    this.#log(this.levels.ERROR, namespace, message, meta);
    return this;
  }

  getLogs() {
    return [...this.logs];
  }

  clearLogs() {
    this.logs = [];
    this.#saveLogs();
    return this;
  }

  performance(operation, durationMs) {
    this.info('PERF', `${operation} took ${durationMs}ms`);
  }
}

export default Logger.getInstance();
