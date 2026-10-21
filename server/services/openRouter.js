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

const PRIHOD_VISION_PROMPT = `Ты опытный кладовщик ресторана в Узбекистане. На фото — рукописная тетрадь / накладная прихода (часто несколько блоков разных поставщиков).

Задача: вытащить ВСЁ, что нужно для складского прихода. Ничего не пропускай — каждую строку товара.

Ответь ТОЛЬКО валидным JSON (без markdown):
{
  "groups": [
    {
      "supplier": "имя поставщика или null",
      "section": "заголовок блока как на фото или null",
      "items": [
        {
          "name": "название товара без фасовки в конце",
          "quantity": число,
          "unit": "кг|л|шт|г",
          "price": число или null,
          "amount": число или null
        }
      ]
    }
  ],
  "extra_costs": [
    { "title": "стоянка|бензин|доставка|…", "amount": число, "capitalize": false }
  ],
  "total": число или null,
  "notes": "краткие заметки или null"
}

Правила чтения:
1) Блоки поставщиков. Новый блок, если видишь заголовок вроде:
   «Перег: …», «Перег; …», «от …», «…дан:», «Қолга олинган», имя фирмы/человека отдельной строкой.
   Если заголовка нет — один group с supplier: null (товары всё равно перечисли).
2) Строка товара обычно: название · кол-во · цена · сумма (итого строки).
   - quantity > 0 (запятая → точка: 4,350 = 4.35)
   - unit: кг / л / шт / г. Если в названии «250гр/500гр/1кг» — это фасовка: unit=шт (или кг если явно вес), а «250гр» можно оставить в name кратко.
   - price — цена за единицу; amount — сумма строки. Если есть amount и quantity, а price нет — price = amount/quantity.
   - Не путай вес/кол-во с ценой: цены обычно тысячи (10000…500000), веса чаще < 100 или с запятой.
3) Доп. расходы внизу (стоянка, бенз/бензин, зав, доставка, такси) — в extra_costs, НЕ в items.
   capitalize: false (это расходы, не в себестоимость товара), кроме явной доставки на товар — тогда true.
4) Итог всей страницы (если есть крупное число внизу) — в total.
5) Не выдумывай строки. Не пропускай середину длинного списка. Пиши все позиции по порядку сверху вниз.
6) Язык названий как на фото (рус/узб). Поставщика пиши без слова «Перег».`;

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

function parseNum(value) {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function normalizeUnit(unit) {
  const u = String(unit || 'шт').trim().toLowerCase();
  if (['кг', 'kg', 'килограмм', 'кило'].includes(u)) return 'кг';
  if (['л', 'l', 'литр', 'литра'].includes(u)) return 'л';
  if (['г', 'гр', 'грамм', 'g'].includes(u)) return 'г';
  if (['шт', 'штук', 'та', 'дона', 'pcs', 'коробка', 'корз', 'кор'].includes(u)) return 'шт';
  return u || 'шт';
}

function cleanSupplierName(name) {
  let s = String(name || '').trim();
  if (!s) return null;
  s = s.replace(/^(перег[.:;]?\s*|от\s+)/i, '').trim();
  s = s.replace(/[-–—]?дан$/i, '').trim();
  return s || null;
}

function normalizeItem(it) {
  const name = String(it?.name || '').trim();
  let quantity = parseNum(it?.quantity);
  let price = parseNum(it?.price);
  let amount = parseNum(it?.amount);
  const unit = normalizeUnit(it?.unit);

  if (!(quantity > 0) && amount != null && price > 0) {
    quantity = Math.round((amount / price) * 1000) / 1000;
  }
  if (!(price > 0) && amount != null && quantity > 0) {
    price = Math.round((amount / quantity) * 100) / 100;
  }
  if (!(amount > 0) && price > 0 && quantity > 0) {
    amount = Math.round(price * quantity * 100) / 100;
  }

  if (!name || !(quantity > 0)) return null;
  return {
    name,
    quantity,
    unit,
    price: price > 0 ? price : null,
    amount: amount > 0 ? amount : null,
  };
}

function normalizeExtraCost(row) {
  const title = String(row?.title || row?.name || '').trim();
  const amount = parseNum(row?.amount);
  if (!title || !(amount > 0)) return null;
  const cap = row?.capitalize;
  // по умолчанию расходы (стоянка/бензин) не в себестоимость
  const capitalize = cap === true || cap === 1 || String(cap).toLowerCase() === 'true';
  return { title, amount, capitalize: !!capitalize };
}

/**
 * Нормализация ответа vision → groups + extra_costs (совместимо со старым {supplier, items}).
 * @param {object} parsed
 */
export function normalizePrihodExtraction(parsed = {}) {
  const extra_costs = (Array.isArray(parsed.extra_costs) ? parsed.extra_costs : [])
    .map(normalizeExtraCost)
    .filter(Boolean);

  let groups = [];
  if (Array.isArray(parsed.groups) && parsed.groups.length) {
    groups = parsed.groups.map((g) => {
      const items = (Array.isArray(g.items) ? g.items : []).map(normalizeItem).filter(Boolean);
      return {
        supplier: cleanSupplierName(g.supplier),
        section: g.section ? String(g.section).trim() || null : null,
        items,
      };
    }).filter((g) => g.items.length > 0);
  } else {
    // старый формат: один supplier + items
    const items = (Array.isArray(parsed.items) ? parsed.items : []).map(normalizeItem).filter(Boolean);
    if (items.length) {
      groups = [{
        supplier: cleanSupplierName(parsed.supplier),
        section: null,
        items,
      }];
    }
  }

  const flatItems = groups.flatMap((g) => g.items);
  return {
    groups,
    supplier: groups[0]?.supplier || cleanSupplierName(parsed.supplier) || null,
    items: flatItems,
    extra_costs,
    total: parseNum(parsed.total),
    notes: parsed.notes ? String(parsed.notes).trim() || null : null,
  };
}

const CASH_SHEET_VISION_PROMPT = `Ты кассир ресторана в Узбекистане. На фото — рукописный дневной лист кассы (тетрадь в клетку).

Нужны ТОЛЬКО операции, которые реально уходят из наличной кассы. Ответь ТОЛЬКО валидным JSON (без markdown):
{
  "date": "YYYY-MM-DD или null",
  "expenses": [ { "label": "как на листе", "amount": число } ],
  "market": [ { "amount": число, "label": "Бозор" } ],
  "payroll": [ { "amount": число, "label": "ишчилар" } ],
  "skipped_notes": "что намеренно не внесли (кратко) или null"
}

Что брать:
1) Правый столбец сверху: мелкие расходы дня (инкасса/инкасса, такси, мусор, напитки, хоз., авансы, имена с суммами). Каждая строка → expenses[].
2) Слева «Бозор» / «бозор» с суммой (наличные на рынок) → market[]. Не путай с мелким «бозор» справа — тот тоже в expenses.
3) «ишчилар» / «ишичилар» (зарплата сотрудникам) → payroll[]. Если написано «13 083 000 + 200 000» — сложи в одну сумму.

Что НЕ брать (только упомяни в skipped_notes):
- «савдо» / «савда» (итог продаж)
- «Аст» / «Act» начало и конец дня (остаток кассы)
- безнал: Терм/Терминал/Click/Payme/Uzum/Илим/Ишим и повторы внизу справа
- крупные слева не про бозор: Банк, Свет, Жами, Ойбек, Xon Atlas, Bonn, Oltin и т.п.

Правила чисел:
- Точки/пробелы в тысячах: 18.684.000 или 18 684 000 → 18684000
- Запятая — десятичная только если явно копейки; обычно целые сумы
- date: если на листе «20 октябрь» / «20 Октябрь» без года — год 2026 → 2026-10-20
- Не выдумывай строки. Язык label как на фото.`;

/**
 * Распознать фото прихода через OpenRouter (vision).
 * @returns {Promise<{ groups, supplier, items, extra_costs, total, notes, raw, model }>}
 */
export async function recognizePrihodPhoto(imageBuffer, mimeType = 'image/jpeg') {
  const body = await callVision(imageBuffer, mimeType, PRIHOD_VISION_PROMPT);
  return finalizeRecognition(body, parseConfig().model);
}

/**
 * Распознать фото дневного листа кассы.
 * @returns {Promise<{ date, expenses, market, payroll, skipped_notes, raw, model }>}
 */
export async function recognizeCashSheetPhoto(imageBuffer, mimeType = 'image/jpeg') {
  const cfg = parseConfig();
  const body = await callVision(imageBuffer, mimeType, CASH_SHEET_VISION_PROMPT);
  const content = body.choices?.[0]?.message?.content;
  const parsed = extractJsonObject(typeof content === 'string' ? content : JSON.stringify(content));
  return {
    ...normalizeCashSheetExtraction(parsed),
    raw: typeof content === 'string' ? content : JSON.stringify(content),
    model: cfg.model,
  };
}

async function callVision(imageBuffer, mimeType, promptText) {
  const cfg = parseConfig();
  if (!cfg.api_key) throw new Error('OpenRouter не настроен: укажите API-ключ в настройках ИИ');
  if (!cfg.model) throw new Error('OpenRouter: выберите модель');
  if (!imageBuffer?.length) throw new Error('Пустое изображение');

  const b64 = Buffer.from(imageBuffer).toString('base64');
  const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${b64}`;

  const payload = {
    model: cfg.model,
    temperature: 0.05,
    max_tokens: 8000,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: promptText },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
  };
  try {
    payload.response_format = { type: 'json_object' };
  } catch { /* */ }

  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: authHeaders(cfg.api_key),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (/response_format|json_object/i.test(text) && payload.response_format) {
      delete payload.response_format;
      const retry = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
        method: 'POST',
        headers: authHeaders(cfg.api_key),
        body: JSON.stringify(payload),
      });
      if (!retry.ok) {
        const t2 = await retry.text().catch(() => '');
        throw new Error(`OpenRouter: ${retry.status} ${t2.slice(0, 300)}`);
      }
      return retry.json();
    }
    throw new Error(`OpenRouter: ${res.status} ${text.slice(0, 300)}`);
  }

  return res.json();
}

function finalizeRecognition(body, model) {
  const content = body.choices?.[0]?.message?.content;
  const parsed = extractJsonObject(typeof content === 'string' ? content : JSON.stringify(content));
  const normalized = normalizePrihodExtraction(parsed);
  return {
    ...normalized,
    raw: typeof content === 'string' ? content : JSON.stringify(content),
    model,
  };
}

/** Нормализация ответа vision по листу кассы. */
export function normalizeCashSheetExtraction(parsed = {}) {
  const expenses = (Array.isArray(parsed.expenses) ? parsed.expenses : [])
    .map((row) => {
      const label = String(row?.label || row?.name || '').trim();
      const amount = parseCashAmount(row?.amount);
      if (!label || !(amount > 0)) return null;
      return { label, amount };
    })
    .filter(Boolean);

  const market = (Array.isArray(parsed.market) ? parsed.market : [])
    .map((row) => {
      const amount = parseCashAmount(row?.amount);
      if (!(amount > 0)) return null;
      return { label: String(row?.label || 'Бозор').trim() || 'Бозор', amount };
    })
    .filter(Boolean);

  const payroll = (Array.isArray(parsed.payroll) ? parsed.payroll : [])
    .map((row) => {
      const amount = parseCashAmount(row?.amount);
      if (!(amount > 0)) return null;
      return { label: String(row?.label || 'ишчилар').trim() || 'ишчилар', amount };
    })
    .filter(Boolean);

  let date = null;
  const rawDate = String(parsed.date || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) date = rawDate;

  return {
    date,
    expenses,
    market,
    payroll,
    skipped_notes: parsed.skipped_notes ? String(parsed.skipped_notes).trim() || null : null,
  };
}

/** Суммы с листа: 18.684.000 / 18 684 000 / 18684000 */
export function parseCashAmount(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  let s = String(value).trim().replace(/\s/g, '');
  if (!s) return null;
  // 18.684.000 или 18,684,000 → убрать разделители тысяч
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) {
    s = s.replace(/[.,]/g, '');
  } else {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}
