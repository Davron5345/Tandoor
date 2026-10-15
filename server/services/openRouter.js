import { getSetting, setSetting, maskToken } from './telegram.js';

const SETTINGS_KEY = 'openrouter_config';
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'google/gemini-2.5-flash';

function emptyConfig() {
  return {
    api_key: '',
    model: DEFAULT_MODEL,
    models_cache: [],
    models_updated_at: null,
  };
}

function parseConfig() {
  const raw = getSetting(SETTINGS_KEY);
  if (!raw) return emptyConfig();
  try {
    const parsed = JSON.parse(raw);
    return {
      ...emptyConfig(),
      ...parsed,
      api_key: String(parsed.api_key || ''),
      model: String(parsed.model || DEFAULT_MODEL),
      models_cache: Array.isArray(parsed.models_cache) ? parsed.models_cache : [],
      models_updated_at: parsed.models_updated_at || null,
    };
  } catch {
    return emptyConfig();
  }
}

function saveConfig(cfg) {
  setSetting(SETTINGS_KEY, JSON.stringify(cfg));
  return cfg;
}

export function getOpenRouterSettings() {
  const cfg = parseConfig();
  return {
    has_api_key: Boolean(cfg.api_key),
    api_key_masked: maskToken(cfg.api_key),
    model: cfg.model || DEFAULT_MODEL,
    models: cfg.models_cache || [],
    models_updated_at: cfg.models_updated_at,
    ready: Boolean(cfg.api_key && cfg.model),
  };
}

export function isOpenRouterReady() {
  const cfg = parseConfig();
  return Boolean(cfg.api_key && cfg.model);
}

export function saveOpenRouterSettings(data = {}) {
  const cfg = parseConfig();
  if (data.api_key != null) {
    const key = String(data.api_key).trim();
    if (key) cfg.api_key = key;
  }
  if (data.clear_api_key) cfg.api_key = '';
  if (data.model != null) {
    const model = String(data.model).trim();
    if (!model) throw new Error('Выберите модель');
    cfg.model = model;
  }
  saveConfig(cfg);
  return getOpenRouterSettings();
}

function authHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': process.env.APP_PUBLIC_URL || 'https://tandoor.local',
    'X-Title': 'Prihod-Rashod AI',
  };
}

/** Список моделей с OpenRouter (кэш в settings). */
export async function refreshOpenRouterModels() {
  const cfg = parseConfig();
  if (!cfg.api_key) throw new Error('Сначала укажите API-ключ OpenRouter');

  const res = await fetch(`${OPENROUTER_BASE}/models`, {
    headers: authHeaders(cfg.api_key),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenRouter модели: ${res.status} ${text.slice(0, 200)}`);
  }
  const body = await res.json();
  const models = (body.data || [])
    .filter((m) => m?.id)
    .map((m) => ({
      id: m.id,
      name: m.name || m.id,
      context_length: m.context_length || null,
      modality: m.architecture?.modality || m.architecture?.input_modalities?.join('+') || null,
    }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));

  // Для фото нужны vision/multimodal — поднимаем их выше в UI, но отдаём весь список
  cfg.models_cache = models;
  cfg.models_updated_at = new Date().toISOString();
  if (cfg.model && !models.some((m) => m.id === cfg.model) && models.length) {
    const vision = models.find((m) => /image|vision|multimodal/i.test(String(m.modality || '')));
    cfg.model = vision?.id || models[0].id;
  }
  saveConfig(cfg);
  return getOpenRouterSettings();
}

const PRIHOD_VISION_PROMPT = `Ты помощник склада ресторана. На фото — рукописная тетрадь или накладная прихода товаров.
Извлеки поставщика и позиции. Ответь ТОЛЬКО валидным JSON без markdown:
{
  "supplier": "имя поставщика или null",
  "items": [
    { "name": "название товара", "quantity": число, "unit": "кг|л|шт|г", "price": число или null }
  ],
  "notes": "краткие заметки или null"
}
Правила:
- quantity — положительное число (запятая → точка)
- unit: кг, л, шт или г; граммы можно оставить как г
- если цены нет — price: null
- не выдумывай товары, которых нет на фото
- если поставщик неясен — supplier: null
- если ничего не разобрал — items: []`;

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('Пустой ответ модели');
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Модель не вернула JSON');
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * Распознать фото прихода через OpenRouter (vision).
 * @param {Buffer} imageBuffer
 * @param {string} mimeType
 * @returns {Promise<{ supplier: string|null, items: Array<{name, quantity, unit, price}>, notes: string|null, raw: string }>}
 */
export async function recognizePrihodPhoto(imageBuffer, mimeType = 'image/jpeg') {
  const cfg = parseConfig();
  if (!cfg.api_key) throw new Error('OpenRouter не настроен: укажите API-ключ в настройках ИИ');
  if (!cfg.model) throw new Error('OpenRouter: выберите модель');
  if (!imageBuffer?.length) throw new Error('Пустое изображение');

  const b64 = Buffer.from(imageBuffer).toString('base64');
  const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${b64}`;

  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: authHeaders(cfg.api_key),
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.1,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PRIHOD_VISION_PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenRouter: ${res.status} ${text.slice(0, 300)}`);
  }

  const body = await res.json();
  const content = body.choices?.[0]?.message?.content;
  const parsed = extractJsonObject(typeof content === 'string' ? content : JSON.stringify(content));
  const items = (Array.isArray(parsed.items) ? parsed.items : [])
    .map((it) => ({
      name: String(it.name || '').trim(),
      quantity: Number(String(it.quantity ?? '').replace(',', '.')),
      unit: normalizeUnit(it.unit),
      price: it.price == null || it.price === '' ? null : Number(String(it.price).replace(',', '.')),
    }))
    .filter((it) => it.name && Number.isFinite(it.quantity) && it.quantity > 0);

  return {
    supplier: parsed.supplier ? String(parsed.supplier).trim() || null : null,
    items,
    notes: parsed.notes ? String(parsed.notes).trim() || null : null,
    raw: typeof content === 'string' ? content : JSON.stringify(content),
    model: cfg.model,
  };
}

function normalizeUnit(unit) {
  const u = String(unit || 'шт').trim().toLowerCase();
  if (['кг', 'kg', 'килограмм'].includes(u)) return 'кг';
  if (['л', 'l', 'литр', 'литра'].includes(u)) return 'л';
  if (['г', 'гр', 'грамм', 'g'].includes(u)) return 'г';
  if (['шт', 'штук', 'та', 'дона', 'pcs'].includes(u)) return 'шт';
  return u || 'шт';
}
