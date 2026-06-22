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
