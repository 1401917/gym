const NVIDIA_CHAT_COMPLETIONS_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const FOOD_SCAN_API_KEY_STORAGE_KEY = 'protein-flow-nvidia-api-key';
const EMBEDDED_FOOD_SCAN_API_KEY = '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';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const GEMINI_API_KEY_STORAGE_KEY = 'protein-flow-gemini-api-key';

export const NVIDIA_FOOD_SCAN_MODEL = 'moonshotai/kimi-k2.5';
// Vision-capable fallbacks if primary model doesn't support image input
export const NVIDIA_FOOD_SCAN_FALLBACK_MODELS = [
  'meta/llama-3.2-11b-vision-instruct',
  'meta/llama-3.2-90b-vision-instruct',
];
const FOOD_SCAN_MAX_TOKENS = 1200;

function clampNumber(value, min, max, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numeric));
}

function interpolate(template, values = {}) {
  return String(template || '').replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = values[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

function readModelMessageContent(content) {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry;
      }

      if (entry?.type === 'text') {
        return entry.text || '';
      }

      return '';
    })
    .join('\n')
    .trim();
}

function parseApiErrorMessage(payloadText, status) {
  try {
    const payload = JSON.parse(payloadText);
    return payload?.detail || payload?.error?.message || payload?.message || `Request failed (${status}).`;
  } catch {
    return payloadText?.trim() || `Request failed (${status}).`;
  }
}

function getCapacitorRuntime() {
  return globalThis.Capacitor || globalThis.window?.Capacitor || null;
}

function isNativeCapacitorRuntime() {
  const capacitor = getCapacitorRuntime();
  if (!capacitor) {
    return false;
  }

  if (typeof capacitor.isNativePlatform === 'function') {
    return capacitor.isNativePlatform();
  }

  const platform = capacitor.getPlatform?.() || capacitor.platform || 'web';
  return platform === 'android' || platform === 'ios';
}

function getCapacitorHttpClient() {
  return globalThis.CapacitorHttp
    || globalThis.window?.CapacitorHttp
    || getCapacitorRuntime()?.Plugins?.CapacitorHttp
    || null;
}

function toResponsePayloadText(data) {
  if (typeof data === 'string') {
    return data;
  }

  if (data === undefined || data === null) {
    return '';
  }

  return JSON.stringify(data);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Unable to read the selected image.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to process the selected image.'));
    image.src = dataUrl;
  });
}

async function compressFoodPhoto(file, { maxDimension = 960, quality = 0.78 } = {}) {
  const originalDataUrl = await readFileAsDataUrl(file);
  if (!file?.type?.startsWith('image/')) {
    return originalDataUrl;
  }

  if (typeof document === 'undefined') {
    return originalDataUrl;
  }

  const image = await loadImage(originalDataUrl);
  const largestSide = Math.max(image.width, image.height);
  const scale = largestSide > maxDimension ? maxDimension / largestSide : 1;

  if (scale === 1 && originalDataUrl.length < 1_600_000) {
    return originalDataUrl;
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d');
  if (!context) {
    return originalDataUrl;
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

export function normalizeFoodScanApiKey(value = '') {
  return String(value || '')
    .replace(/^Bearer\s+/i, '')
    .trim();
}

export function getEmbeddedFoodScanApiKey() {
  return normalizeFoodScanApiKey(EMBEDDED_FOOD_SCAN_API_KEY);
}

export function hasEmbeddedFoodScanApiKey() {
  return Boolean(getEmbeddedFoodScanApiKey());
}

export function getStoredFoodScanApiKey(storage = globalThis.localStorage, { fallbackToEmbedded = true } = {}) {
  try {
    const stored = normalizeFoodScanApiKey(storage?.getItem(FOOD_SCAN_API_KEY_STORAGE_KEY));
    if (stored) {
      return stored;
    }
  } catch {
    return fallbackToEmbedded ? getEmbeddedFoodScanApiKey() : '';
  }

  return fallbackToEmbedded ? getEmbeddedFoodScanApiKey() : '';
}

export function storeFoodScanApiKey(value, storage = globalThis.localStorage) {
  const normalized = normalizeFoodScanApiKey(value);
  const embedded = getEmbeddedFoodScanApiKey();

  try {
    if (!normalized) {
      storage?.removeItem(FOOD_SCAN_API_KEY_STORAGE_KEY);
      return embedded;
    }

    if (normalized === embedded) {
      storage?.removeItem(FOOD_SCAN_API_KEY_STORAGE_KEY);
      return embedded;
    }

    storage?.setItem(FOOD_SCAN_API_KEY_STORAGE_KEY, normalized);
  } catch {
    return normalized || embedded;
  }

  return normalized || embedded;
}

export function getStoredGeminiApiKey(storage = globalThis.localStorage) {
  try {
    return normalizeFoodScanApiKey(storage?.getItem(GEMINI_API_KEY_STORAGE_KEY)) || '';
  } catch {
    return '';
  }
}

export function storeGeminiApiKey(value, storage = globalThis.localStorage) {
  const normalized = normalizeFoodScanApiKey(value);
  try {
    if (!normalized) {
      storage?.removeItem(GEMINI_API_KEY_STORAGE_KEY);
    } else {
      storage?.setItem(GEMINI_API_KEY_STORAGE_KEY, normalized);
    }
  } catch {}
  return normalized;
}

export function buildFoodPhotoPrompt() {
  return [
    'Analyze the food visible in this image.',
    'Estimate the total calories and total protein for the visible serving.',
    'List the main ingredients you can identify (up to 8 items).',
    'Reply with strict JSON only. No markdown, no extra text.',
    'Use exactly this shape:',
    '{"name":"Food name","calories":520,"protein":38,"ingredients":["ingredient 1","ingredient 2"],"confidence":0.85,"notes":"Short note about the estimate"}',
  ].join('\n');
}

export function extractFoodScanJson(text = '') {
  const source = String(text || '').trim();
  if (!source) {
    throw new Error('The model returned an empty response.');
  }

  const fencedMatch = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonCandidate = fencedMatch ? fencedMatch[1].trim() : source;
  const start = jsonCandidate.indexOf('{');
  const end = jsonCandidate.lastIndexOf('}');

  if (start === -1 || end === -1 || end < start) {
    throw new Error('The response did not include valid JSON.');
  }

  return JSON.parse(jsonCandidate.slice(start, end + 1));
}

export function getFoodScanResponseText(message = {}) {
  const content = readModelMessageContent(message?.content);
  if (content) {
    return content;
  }

  return readModelMessageContent(message?.reasoning_content || message?.reasoning);
}

function buildFoodScanModelCandidates(model) {
  const primary = String(model || NVIDIA_FOOD_SCAN_MODEL).trim();
  return [primary, ...NVIDIA_FOOD_SCAN_FALLBACK_MODELS].filter((candidate, index, list) => (
    candidate && list.indexOf(candidate) === index
  ));
}

function isAuthenticationError(error) {
  const message = String(error?.message || '');
  return /auth|unauthorized|authentication|valid.*api key|api key.*invalid/i.test(message);
}

export function normalizeFoodScanResult(result = {}) {
  const name = String(result?.name || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);

  if (!name) {
    throw new Error('The response did not include a food name.');
  }

  const rawIngredients = Array.isArray(result?.ingredients) ? result.ingredients : [];
  const ingredients = rawIngredients
    .slice(0, 8)
    .map((i) => String(i || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  return {
    name,
    calories: Math.round(clampNumber(result?.calories, 0, 10000)),
    protein: Math.round(clampNumber(result?.protein, 0, 1000) * 10) / 10,
    ingredients,
    confidence: Math.round(clampNumber(result?.confidence, 0, 1) * 100) / 100,
    notes: String(result?.notes || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240),
  };
}

async function sendFoodScanRequest(payload, normalizedApiKey, fetchImpl) {
  const headers = {
    Authorization: `Bearer ${normalizedApiKey}`,
    'Content-Type': 'application/json',
  };

  const capacitorHttp = getCapacitorHttpClient();
  if (isNativeCapacitorRuntime() && capacitorHttp?.request) {
    const response = await capacitorHttp.request({
      url: NVIDIA_CHAT_COMPLETIONS_URL,
      method: 'POST',
      headers,
      data: payload,
      connectTimeout: 45000,
      readTimeout: 45000,
      responseType: 'json',
    });

    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      payloadText: toResponsePayloadText(response.data),
    };
  }

  const response = await fetchImpl(NVIDIA_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  return {
    ok: response.ok,
    status: response.status,
    payloadText: await response.text(),
  };
}

async function analyzeWithGemini(imageDataUrl, apiKey, fetchImpl) {
  const parts = imageDataUrl.split(',');
  const base64Data = parts[1] || '';
  const mimeType = parts[0]?.split(';')[0]?.split(':')[1] || 'image/jpeg';

  const url = `${GEMINI_API_BASE}?key=${apiKey}`;
  const body = {
    contents: [{
      parts: [
        { text: buildFoodPhotoPrompt() },
        { inline_data: { mime_type: mimeType, data: base64Data } },
      ],
    }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 1200 },
  };

  const capacitorHttp = getCapacitorHttpClient();
  let responseOk;
  let responseStatus;
  let responseText;

  if (isNativeCapacitorRuntime() && capacitorHttp?.request) {
    const response = await capacitorHttp.request({
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: body,
      connectTimeout: 45000,
      readTimeout: 60000,
      responseType: 'json',
    });
    responseOk = response.status >= 200 && response.status < 300;
    responseStatus = response.status;
    responseText = toResponsePayloadText(response.data);
  } else {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    responseOk = response.ok;
    responseStatus = response.status;
    responseText = await response.text();
  }

  if (!responseOk) {
    throw new Error(parseApiErrorMessage(responseText, responseStatus));
  }

  const data = JSON.parse(responseText);
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini returned an empty response. Please try again.');
  }

  return normalizeFoodScanResult(extractFoodScanJson(text));
}

export async function analyzeFoodPhoto({
  file,
  geminiApiKey,
  apiKey,
  model = NVIDIA_FOOD_SCAN_MODEL,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!file) {
    throw new Error('Choose a photo before starting the AI scan.');
  }

  if (typeof fetchImpl !== 'function') {
    throw new Error('Network access is not available on this device right now.');
  }

  const imageDataUrl = await compressFoodPhoto(file);
  const prompt = interpolate(buildFoodPhotoPrompt());

  // Try Gemini first — free API with generous limits
  const normalizedGeminiKey = normalizeFoodScanApiKey(geminiApiKey);
  if (normalizedGeminiKey) {
    try {
      const result = await analyzeWithGemini(imageDataUrl, normalizedGeminiKey, fetchImpl);
      return {
        ...result,
        provider: 'gemini',
        rawText: '',
        prompt,
        model: 'gemini-2.0-flash',
      };
    } catch (error) {
      if (isAuthenticationError(error)) {
        throw error;
      }
      // Fall through to NVIDIA
    }
  }

  // Fall back to NVIDIA (embedded key)
  const normalizedNvidiaKey = normalizeFoodScanApiKey(apiKey);
  if (!normalizedNvidiaKey) {
    throw new Error('No API key found. Add a free Gemini key from ai.google.dev to enable food scanning.');
  }

  const modelCandidates = buildFoodScanModelCandidates(model);
  const attemptErrors = [];

  for (const candidateModel of modelCandidates) {
    try {
      const requestPayload = {
        model: candidateModel,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: buildFoodPhotoPrompt() },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        }],
        max_tokens: FOOD_SCAN_MAX_TOKENS,
        temperature: 0.2,
        top_p: 1.0,
        stream: false,
        chat_template_kwargs: { thinking: false },
      };

      const response = await sendFoodScanRequest(requestPayload, normalizedNvidiaKey, fetchImpl);
      if (!response.ok) {
        throw new Error(parseApiErrorMessage(response.payloadText, response.status));
      }

      let payload = {};
      try {
        payload = JSON.parse(response.payloadText);
      } catch {
        throw new Error('The NVIDIA response was not valid JSON.');
      }

      const choice = payload?.choices?.[0] || {};
      const content = getFoodScanResponseText(choice?.message);
      if (!content) {
        if (choice?.finish_reason === 'length') {
          throw new Error('NVIDIA stopped before returning the meal details. Please try again.');
        }

        throw new Error('The NVIDIA model returned an empty response.');
      }

      const parsed = extractFoodScanJson(content);

      return {
        ...normalizeFoodScanResult(parsed),
        provider: 'nvidia',
        rawText: content,
        prompt,
        model: candidateModel,
      };
    } catch (error) {
      attemptErrors.push({ model: candidateModel, error });

      if (isAuthenticationError(error)) {
        throw error;
      }
    }
  }

  throw attemptErrors[0]?.error || new Error('Food scan failed. Please try again.');
}
