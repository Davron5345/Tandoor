import { v4 as uuidv4 } from 'uuid';
import db from './db.js';
import { getBranch } from './branches.js';
import { getProducts } from './services/products.js';
import { getSetting, setSetting } from './services/telegram.js';
import { sendShopOrderNotification } from './telegram.js';

const { queryAll, queryOne, run } = db;

const ORDER_STATUSES = new Set(['new', 'processing', 'done', 'cancelled']);

export const ORDER_STATUS_LABELS = {
  new: 'Новый',
  processing: 'В работе',
  done: 'Выполнен',
  cancelled: 'Отменён',
};

function settingsKey(branchId) {
  return `shop_settings:${branchId}`;
}

export function getShopSettings(branchId) {
  const raw = getSetting(settingsKey(branchId));
  let parsed = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
  }
  return {
    enabled: parsed.enabled !== false,
    notifyChatId: parsed.notifyChatId || getSetting('shop_notify_chat_id') || '',
  };
}

export function saveShopSettings(branchId, data) {
  const current = getShopSettings(branchId);
  const next = {
    enabled: data.enabled !== undefined ? !!data.enabled : current.enabled,
    notifyChatId: data.notifyChatId !== undefined ? String(data.notifyChatId || '').trim() : current.notifyChatId,
  };
  setSetting(settingsKey(branchId), JSON.stringify(next));
  if (data.notifyChatId !== undefined && data.notifyChatId) {
    setSetting('shop_notify_chat_id', String(data.notifyChatId).trim());
  }
  return next;
}

function getNextOrderNumber(branchId) {
  return queryOne(
    'SELECT COALESCE(MAX(number), 0) + 1 as n FROM shop_orders WHERE branch_id = ?',
    [branchId],
  ).n;
}

function buildProductMaps(branchId) {
  const products = getProducts({ branch_id: branchId, archived: '0' });
  const byId = new Map();
  const variantById = new Map();

  for (const product of products) {
    byId.set(product.id, product);
    for (const variant of product.variants || []) {
      variantById.set(`${product.id}:${variant.id}`, { product, variant });
    }
  }

  return { byId, variantById, products };
}

function resolveLineItem(maps, item) {
  const productId = String(item.product_id || '');
  const variantId = item.variant_id ? String(item.variant_id) : null;
  const quantity = Number(item.quantity);

  if (!productId || !Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('Некорректная позиция заказа');
  }

  if (variantId) {
    const row = maps.variantById.get(`${productId}:${variantId}`);
    if (!row) throw new Error('Товар или вариант не найден');
    const { product, variant } = row;
    const price = variant.price ?? product.price ?? 0;
    return {
      product_id: productId,
      variant_id: variantId,
      product_name: product.name,
      variant_name: variant.name,
      quantity,
      price,
      unit: product.unit || 'шт',
      line_total: price * quantity,
    };
  }

  const product = maps.byId.get(productId);
  if (!product) throw new Error('Товар не найден');
  if (product.has_variants) throw new Error(`Выберите вариант для «${product.name}»`);
  const price = product.price ?? 0;
  return {
    product_id: productId,
    variant_id: null,
    product_name: product.name,
    variant_name: null,
    quantity,
    price,
    unit: product.unit || 'шт',
    line_total: price * quantity,
  };
}

export function createShopOrder(branchId, payload) {
  const branch = getBranch(branchId);
  if (!branch || !branch.active) throw new Error('Филиал не найден');

  const settings = getShopSettings(branchId);
  if (!settings.enabled) throw new Error('Магазин временно недоступен');

  const customerName = String(payload.customer_name || '').trim();
  const customerPhone = String(payload.customer_phone || '').replace(/\D/g, '');
  const deliveryType = payload.delivery_type === 'delivery' ? 'delivery' : 'pickup';
  const address = String(payload.address || '').trim();
  const comment = String(payload.comment || '').trim();
  const itemsInput = Array.isArray(payload.items) ? payload.items : [];

  if (!customerName) throw new Error('Укажите имя');
  if (customerPhone.length < 9) throw new Error('Укажите корректный телефон');
  if (itemsInput.length === 0) throw new Error('Корзина пуста');
  if (deliveryType === 'delivery' && !address) throw new Error('Укажите адрес доставки');

  const maps = buildProductMaps(branchId);
  const lines = itemsInput.map((item) => resolveLineItem(maps, item));
  const totalAmount = lines.reduce((sum, line) => sum + line.line_total, 0);
  const orderId = uuidv4();
  const number = getNextOrderNumber(branchId);

  run(
    `INSERT INTO shop_orders
      (id, branch_id, number, customer_name, customer_phone, delivery_type, address, comment, status, total_amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`,
    [orderId, branchId, number, customerName, customerPhone, deliveryType, address, comment, totalAmount],
  );

  for (const line of lines) {
    run(
      `INSERT INTO shop_order_items
        (id, order_id, product_id, variant_id, product_name, variant_name, quantity, price, unit, line_total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        orderId,
        line.product_id,
        line.variant_id,
        line.product_name,
        line.variant_name,
        line.quantity,
        line.price,
        line.unit,
        line.line_total,
      ],
    );
  }

  const order = getShopOrder(orderId);
  sendShopOrderNotification(order, branch).catch((err) => {
    console.error('Shop order telegram notify failed:', err.message);
  });

  return order;
}

export function getShopOrder(id) {
  const order = queryOne('SELECT * FROM shop_orders WHERE id = ?', [id]);
  if (!order) return null;
  const items = queryAll('SELECT * FROM shop_order_items WHERE order_id = ? ORDER BY product_name', [id]);
  return {
    ...order,
    status_label: ORDER_STATUS_LABELS[order.status] || order.status,
    items,
  };
}

export function getShopOrders(branchId, filters = {}) {
  let sql = 'SELECT * FROM shop_orders WHERE branch_id = ?';
  const params = [branchId];

  if (filters.status && ORDER_STATUSES.has(filters.status)) {
    sql += ' AND status = ?';
    params.push(filters.status);
  }

  sql += ' ORDER BY created_at DESC, number DESC LIMIT ?';
  params.push(Math.min(Number(filters.limit) || 100, 200));

  return queryAll(sql, params).map((order) => ({
    ...order,
    status_label: ORDER_STATUS_LABELS[order.status] || order.status,
  }));
}

export function updateShopOrderStatus(id, status, branchId) {
  if (!ORDER_STATUSES.has(status)) throw new Error('Некорректный статус');
  const order = getShopOrder(id);
  if (!order) throw new Error('Заказ не найден');
  if (order.branch_id !== branchId) throw new Error('Нет доступа к заказу');

  run(
    'UPDATE shop_orders SET status = ?, updated_at = datetime(\'now\') WHERE id = ?',
    [status, id],
  );

  return getShopOrder(id);
}
