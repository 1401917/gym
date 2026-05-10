import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeFoodPhoto,
  extractFoodScanJson,
  getFoodScanResponseText,
  getStoredFoodScanApiKey,
  normalizeFoodScanApiKey,
  normalizeFoodScanResult,
  storeFoodScanApiKey,
} from '../scripts/food-photo-ai.js';

test('normalizeFoodScanApiKey trims surrounding whitespace', () => {
  assert.equal(normalizeFoodScanApiKey('  nvapi-demo-key  '), 'nvapi-demo-key');
  assert.equal(normalizeFoodScanApiKey('Bearer nvapi-demo-key'), 'nvapi-demo-key');
  assert.equal(normalizeFoodScanApiKey(''), '');
});

test('getStoredFoodScanApiKey can fall back to the embedded app key', () => {
  const storage = {
    getItem() {
      return '';
    },
  };

  assert.equal(getStoredFoodScanApiKey(storage, { fallbackToEmbedded: false }), '');
  assert.match(getStoredFoodScanApiKey(storage), /^nvapi-/);
});

test('storeFoodScanApiKey returns the embedded key when no override is provided', () => {
  let removed = false;
  const storage = {
    removeItem() {
      removed = true;
    },
    setItem() {
      throw new Error('setItem should not run for the embedded fallback path');
    },
  };

  const result = storeFoodScanApiKey('', storage);
  assert.equal(removed, true);
  assert.match(result, /^nvapi-/);
});

test('extractFoodScanJson parses fenced JSON responses', () => {
  const parsed = extractFoodScanJson('```json\n{"name":"Chicken bowl","calories":640,"protein":38}\n```');

  assert.equal(parsed.name, 'Chicken bowl');
  assert.equal(parsed.calories, 640);
  assert.equal(parsed.protein, 38);
});

test('getFoodScanResponseText falls back to reasoning text when content is empty', () => {
  const text = getFoodScanResponseText({
    content: null,
    reasoning: ' {"name":"Chicken bowl","calories":640,"protein":38}',
  });

  assert.equal(text, '{"name":"Chicken bowl","calories":640,"protein":38}');
});

test('normalizeFoodScanResult sanitizes nutrition estimates', () => {
  const result = normalizeFoodScanResult({
    name: '  Chicken bowl   ',
    calories: '642.8',
    protein: '38.44',
    confidence: '0.812',
    notes: ' Portion estimate based on one medium bowl. ',
  });

  assert.deepEqual(result, {
    name: 'Chicken bowl',
    calories: 643,
    protein: 38.4,
    ingredients: [],
    confidence: 0.81,
    notes: 'Portion estimate based on one medium bowl.',
  });
});

test('normalizeFoodScanResult filters nutrients from ingredient lists', () => {
  const result = normalizeFoodScanResult({
    name: 'Banana',
    calories: 105,
    protein: 1.3,
    ingredients: ['Potassium', 'Carbohydrates', 'Fiber', 'Vitamin B6', 'banana'],
  });

  assert.deepEqual(result.ingredients, ['banana']);
});

test('normalizeFoodScanResult falls back to the food name when all listed ingredients are nutrients', () => {
  const result = normalizeFoodScanResult({
    name: 'Banana',
    calories: 105,
    protein: 1.3,
    ingredients: ['Potassium', 'Carbohydrates', 'Fiber'],
  });

  assert.deepEqual(result.ingredients, ['Banana']);
});

test('normalizeFoodScanResult removes placeholder notes copied from the schema', () => {
  const result = normalizeFoodScanResult({
    name: 'Banana',
    calories: 105,
    protein: 1.3,
    notes: 'Short note about the estimate',
  });

  assert.equal(result.notes, '');
});

test('analyzeFoodPhoto uses the configured Gemini key when provided', async () => {
  const originalFileReader = globalThis.FileReader;

  class FileReaderMock {
    constructor() {
      this.result = null;
      this.onload = null;
      this.onerror = null;
    }

    async readAsDataURL(file) {
      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        this.result = `data:${file.type};base64,${buffer.toString('base64')}`;
        this.onload?.();
      } catch (error) {
        this.onerror?.(error);
      }
    }
  }

  globalThis.FileReader = FileReaderMock;
  const calls = [];

  try {
    const file = new File([Buffer.from('test-image')], 'banana.jpg', { type: 'image/jpeg' });
    const result = await analyzeFoodPhoto({
      file,
      geminiApiKey: 'gemini-demo-key',
      apiKey: 'nvapi-demo-key',
      fetchImpl: async (url, options) => {
        calls.push({ url, body: JSON.parse(options.body) });
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              candidates: [{
                content: {
                  parts: [{
                    text: '{"name":"Banana","calories":105,"protein":1.3,"ingredients":["banana"],"confidence":0.9,"notes":"One medium banana."}',
                  }],
                },
              }],
            });
          },
        };
      },
    });

    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.0-flash:generateContent\?key=gemini-demo-key$/);
    assert.equal(calls[0].body.contents[0].parts[1].inline_data.mime_type, 'image/jpeg');
    assert.equal(result.provider, 'gemini');
    assert.equal(result.name, 'Banana');
    assert.equal(result.calories, 105);
    assert.equal(result.protein, 1.3);
    assert.deepEqual(result.ingredients, ['banana']);
  } finally {
    globalThis.FileReader = originalFileReader;
  }
});

test('analyzeFoodPhoto can use the native CapacitorHttp path', async () => {
  const originalFileReader = globalThis.FileReader;
  const originalCapacitor = globalThis.Capacitor;
  const originalCapacitorHttp = globalThis.CapacitorHttp;

  class FileReaderMock {
    constructor() {
      this.result = null;
      this.onload = null;
      this.onerror = null;
    }

    async readAsDataURL(file) {
      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        this.result = `data:${file.type};base64,${buffer.toString('base64')}`;
        this.onload?.();
      } catch (error) {
        this.onerror?.(error);
      }
    }
  }

  globalThis.FileReader = FileReaderMock;
  globalThis.Capacitor = {
    isNativePlatform() {
      return true;
    },
    getPlatform() {
      return 'android';
    },
  };
  globalThis.CapacitorHttp = {
    async request() {
      return {
        status: 200,
        data: {
          choices: [{
            message: {
              content: '{"name":"Chicken bowl","calories":640,"protein":38,"confidence":0.82,"notes":"Estimate"}',
            },
          }],
        },
        headers: {},
        url: 'https://integrate.api.nvidia.com/v1/chat/completions',
      };
    },
  };

  try {
    const file = new File([Buffer.from('test-image')], 'food.jpg', { type: 'image/jpeg' });
    const result = await analyzeFoodPhoto({
      file,
      apiKey: 'nvapi-demo-key',
      fetchImpl: async () => {
        throw new Error('fetch should not be used for the native path test');
      },
    });

    assert.equal(result.name, 'Chicken bowl');
    assert.equal(result.calories, 640);
    assert.equal(result.protein, 38);
  } finally {
    globalThis.FileReader = originalFileReader;
    globalThis.Capacitor = originalCapacitor;
    globalThis.CapacitorHttp = originalCapacitorHttp;
  }
});
