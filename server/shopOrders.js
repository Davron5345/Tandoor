import { v4 as uuidv4 } from 'uuid';
import db from './db.js';
import { getBranch } from './branches.js';
import { assertDepartmentInBranch, getDefaultDepartmentId } from './departments.js';
import { getProducts } from './services/products.js';
import { getSetting, setSetting } from './services/telegram.js';
import { sendShopOrderNotification } from './telegram.js';
import { createDocument } from './services/documents.js';

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

function resolveItemImageUrl(productId, variantId) {
  if (variantId) {
    const variantImage = queryOne(`
      SELECT file_name FROM product_images
      WHERE product_id = ? AND variant_id = ?
      ORDER BY is_primary DESC, sort_order ASC, created_at ASC
      LIMIT 1
    `, [productId, variantId]);
    if (variantImage?.file_name) {
      return `/uploads/products/${productId}/${variantImage.file_name}`;
    }
  }

  const image = queryOne(`
    SELECT file_name FROM product_images
    WHERE product_id = ?
    ORDER BY is_primary DESC, sort_order ASC, created_at ASC
    LIMIT 1
  `, [productId]);

  if (!image?.file_name) return null;
  return `/uploads/products/${productId}/${image.file_name}`;
}

function enrichOrderItems(items) {
  return items.map((item) => ({
    ...item,
    image_url: resolveItemImageUrl(item.product_id, item.variant_id),
  }));
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

export function createShopOrder(branchId, payload, departmentId = null) {
  const branch = getBranch(branchId);
  if (!branch || !branch.active) throw new Error('Филиал не найден');

  const settings = getShopSettings(branchId);
  if (!settings.enabled) throw new Error('Магазин временно недоступен');

  let department = null;
  const resolvedDepartmentId = departmentId || payload.department_id || null;
  if (resolvedDepartmentId) {
    department = assertDepartmentInBranch(resolvedDepartmentId, branchId);
  }

  const customerName = department
    ? department.name
    : (String(payload.customer_name || '').trim() || 'Гость');
  const customerPhoneRaw = String(payload.customer_phone || '').replace(/\D/g, '');
  const customerPhone = customerPhoneRaw.length >= 9 ? customerPhoneRaw : '—';
  const deliveryType = payload.delivery_type === 'delivery' ? 'delivery' : 'pickup';
  const address = String(payload.address || '').trim();
  const comment = String(payload.comment || '').trim();
  const itemsInput = Array.isArray(payload.items) ? payload.items : [];

  if (itemsInput.length === 0) throw new Error('Корзина пуста');
  if (deliveryType === 'delivery' && !address) throw new Error('Укажите адрес доставки');

  const maps = buildProductMaps(branchId);
  const lines = itemsInput.map((item) => resolveLineItem(maps, item));
  const totalAmount = lines.reduce((sum, line) => sum + line.line_total, 0);
  const orderId = uuidv4();
  const number = getNextOrderNumber(branchId);

  run(
    `INSERT INTO shop_orders
      (id, branch_id, department_id, number, customer_name, customer_phone, delivery_type, address, comment, status, total_amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`,
    [orderId, branchId, department?.id || null, number, customerName, customerPhone, deliveryType, address, comment, totalAmount],
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
  const order = queryOne(`
    SELECT so.*, d.name as department_name, doc.number as document_number
    FROM shop_orders so
    LEFT JOIN departments d ON d.id = so.department_id
    LEFT JOIN documents doc ON doc.id = so.document_id
    WHERE so.id = ?
  `, [id]);
  if (!order) return null;
  const items = enrichOrderItems(
    queryAll('SELECT * FROM shop_order_items WHERE order_id = ? ORDER BY product_name', [id]),
  );
  return {
    ...order,
    status_label: ORDER_STATUS_LABELS[order.status] || order.status,
    items,
  };
}

export function getShopOrders(branchId, filters = {}) {
  let sql = `
    SELECT so.*, d.name as department_name
    FROM shop_orders so
    LEFT JOIN departments d ON d.id = so.department_id
    WHERE so.branch_id = ?
  `;
  const params = [branchId];

  if (filters.status && ORDER_STATUSES.has(filters.status)) {
    sql += ' AND so.status = ?';
    params.push(filters.status);
  }

  sql += ' ORDER BY so.created_at DESC, so.number DESC LIMIT ?';
  params.push(Math.min(Number(filters.limit) || 100, 200));

  return queryAll(sql, params).map((order) => ({
    ...order,
    status_label: ORDER_STATUS_LABELS[order.status] || order.status,
  }));
}

function fulfillShopOrder(order, userId = 'system') {
  if (order.document_id) return order.document_id;
  if (order.status !== 'done') return null;

  const branchId = order.branch_id;
  const fromDepartmentId = order.department_id || getDefaultDepartmentId(branchId);
  if (!fromDepartmentId) throw new Error('Не найден склад для проведения заказа MyShop');

  const items = queryAll('SELECT * FROM shop_order_items WHERE order_id = ?', [order.id]);
  if (items.length === 0) throw new Error('В заказе нет позиций');

  const doc = createDocument({
    type: 'rashod',
    date: new Date().toISOString().slice(0, 10),
    comment: `MyShop заказ №${order.number}${order.customer_name ? ` · ${order.customer_name}` : ''}`,
    from_department_id: fromDepartmentId,
    items: items.map((item) => ({
      product_id: item.product_id,
      variant_id: item.variant_id || null,
      quantity: item.quantity,
      price: item.price,
    })),
    status: 'confirmed',
  }, userId, branchId);

  run('UPDATE shop_orders SET document_id = ?, updated_at = datetime(\'now\') WHERE id = ?', [doc.id, order.id]);
  return doc.id;
}

export function updateShopOrderStatus(id, status, branchId, userId = 'system') {
  if (!ORDER_STATUSES.has(status)) throw new Error('Некорректный статус');
  const order = getShopOrder(id);
  if (!order) throw new Error('Заказ не найден');
  if (order.branch_id !== branchId) throw new Error('Нет доступа к заказу');

  run(
    'UPDATE shop_orders SET status = ?, updated_at = datetime(\'now\') WHERE id = ?',
    [status, id],
  );

  const updated = getShopOrder(id);
  if (status === 'done') {
    try {
      fulfillShopOrder(updated, userId);
    } catch (err) {
      run('UPDATE shop_orders SET status = ?, updated_at = datetime(\'now\') WHERE id = ?', [order.status, id]);
      throw err;
    }
  }

  return getShopOrder(id);
}
