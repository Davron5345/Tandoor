import webpush from 'web-push';
import { v4 as uuidv4 } from 'uuid';
import db from './db.js';
import { hasPermission } from './permissions.js';

const { queryAll, queryOne, run } = db;

let vapidReady = false;
let vapidPublicKey = null;

export function initWebPush() {
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@warehouse.local';
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;

  if (!publicKey || !privateKey) {
    if (process.env.NODE_ENV === 'production') {
      console.warn('⚠️ Push-уведомления отключены: задайте VAPID_PUBLIC_KEY и VAPID_PRIVATE_KEY в .env');
    }
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidPublicKey = publicKey;
  vapidReady = true;
  return true;
}

export function isPushEnabled() {
  return vapidReady;
}

export function getVapidPublicKey() {
  return vapidPublicKey;
}

export function savePushSubscription(userId, branchId, subscription, userAgent = '') {
  const endpoint = subscription?.endpoint;
  const keys = subscription?.keys || {};
  if (!endpoint || !keys.p256dh || !keys.auth) {
    throw new Error('Некорректная подписка на уведомления');
  }

  run('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
  run(`
    INSERT INTO push_subscriptions (id, user_id, branch_id, endpoint, p256dh, auth, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    uuidv4(),
    userId,
    branchId || null,
    endpoint,
    keys.p256dh,
    keys.auth,
    userAgent || null,
  ]);
}

export function removePushSubscription(userId, endpoint) {
  if (endpoint) {
    run('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', [userId, endpoint]);
    return;
  }
  run('DELETE FROM push_subscriptions WHERE user_id = ?', [userId]);
}

function subscriptionPayload(row) {
  return {
    endpoint: row.endpoint,
    keys: {
      p256dh: row.p256dh,
      auth: row.auth,
    },
  };
}

async function sendToSubscription(row, payload) {
  try {
    await webpush.sendNotification(subscriptionPayload(row), JSON.stringify(payload));
    return { ok: true };
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      run('DELETE FROM push_subscriptions WHERE id = ?', [row.id]);
    }
    return { ok: false, error: err.message };
  }
}

function getEligibleSubscriptions(branchId) {
  const rows = queryAll(`
    SELECT ps.*, u.role
    FROM push_subscriptions ps
    JOIN users u ON u.id = ps.user_id AND u.active = 1
    WHERE ps.branch_id = ? OR ps.branch_id IS NULL
  `, [branchId]);

  return rows.filter((row) => hasPermission(row.role, 'shop_orders.view'));
}

export async function notifyShopOrderPush(order) {
  if (!vapidReady || !order?.branch_id) return { sent: 0 };

  const subs = getEligibleSubscriptions(order.branch_id);
  if (!subs.length) return { sent: 0 };

  const itemCount = order.items?.length
    || queryOne('SELECT COUNT(*) as c FROM shop_order_items WHERE order_id = ?', [order.id])?.c
    || 0;

  const payload = {
    title: `Заявка №${order.number}`,
    body: [
      order.department_name,
      order.customer_name,
      itemCount ? `${itemCount} поз.` : null,
    ].filter(Boolean).join(' · ') || 'Новая заявка с кухни',
    url: '/warehouse/orders',
    tag: `shop-order-${order.id}`,
  };

  let sent = 0;
  for (const sub of subs) {
    const result = await sendToSubscription(sub, payload);
    if (result.ok) sent += 1;
  }
  return { sent };
}

export function listPushSubscribers({ branchId, permission = 'shop_orders.view' } = {}) {
  const rows = queryAll(`
    SELECT ps.id, ps.user_id, ps.branch_id, ps.endpoint, ps.user_agent, ps.created_at,
           u.username, u.name, u.role, b.name AS branch_name
    FROM push_subscriptions ps
    JOIN users u ON u.id = ps.user_id AND u.active = 1
    LEFT JOIN branches b ON b.id = ps.branch_id
    ORDER BY u.username, ps.created_at DESC
  `);

  return rows.filter((row) => {
    if (branchId && row.branch_id && row.branch_id !== branchId) return false;
    if (permission && !hasPermission(row.role, permission)) return false;
    return true;
  });
}

function uniqueSubscriptions(rows) {
  const map = new Map();
  for (const row of rows) {
    map.set(row.endpoint, row);
  }
  return [...map.values()];
}

export async function sendAdminPush({
  title,
  body,
  url = '/snab',
  branchId,
  userIds,
  target = 'snab',
}) {
  if (!vapidReady) {
    throw new Error('Push-уведомления не настроены на сервере');
  }

  const trimmedTitle = String(title || '').trim();
  const trimmedBody = String(body || '').trim();
  if (!trimmedTitle) {
    throw new Error('Укажите заголовок уведомления');
  }
  if (!trimmedBody) {
    throw new Error('Укажите текст уведомления');
  }

  let subs;
  if (Array.isArray(userIds) && userIds.length) {
    const placeholders = userIds.map(() => '?').join(',');
    subs = queryAll(`
      SELECT ps.*, u.role
      FROM push_subscriptions ps
      JOIN users u ON u.id = ps.user_id AND u.active = 1
      WHERE ps.user_id IN (${placeholders})
    `, userIds);
  } else if (target === 'selected') {
    throw new Error('Выберите хотя бы одного получателя в списке подписчиков');
  } else if (target === 'all') {
    subs = queryAll(`
      SELECT ps.*, u.role
      FROM push_subscriptions ps
      JOIN users u ON u.id = ps.user_id AND u.active = 1
    `);
  } else if (branchId) {
    subs = getEligibleSubscriptions(branchId);
  } else {
    subs = queryAll(`
      SELECT ps.*, u.role
      FROM push_subscriptions ps
      JOIN users u ON u.id = ps.user_id AND u.active = 1
    `).filter((row) => hasPermission(row.role, 'shop_orders.view'));
  }

  subs = uniqueSubscriptions(subs);
  if (!subs.length) {
    return { sent: 0, failed: 0, total: 0 };
  }

  const payload = {
    title: trimmedTitle,
    body: trimmedBody,
    url: String(url || '/snab').trim() || '/snab',
    tag: `admin-push-${Date.now()}`,
  };

  let sent = 0;
  let failed = 0;
  for (const sub of subs) {
    const result = await sendToSubscription(sub, payload);
    if (result.ok) sent += 1;
    else failed += 1;
  }
  return { sent, failed, total: subs.length };
}
