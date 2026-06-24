import { requirePermission, attachBranch, requireAdmin } from '../middleware.js';
import {
  getVapidPublicKey,
  isPushEnabled,
  savePushSubscription,
  removePushSubscription,
  listPushSubscribers,
  sendAdminPush,
} from '../push.js';

export function registerPublicPushRoutes(app) {
  app.get('/api/push/vapid-public-key', (_req, res) => {
    if (!isPushEnabled()) {
      return res.status(503).json({ error: 'Push-уведомления не настроены на сервере' });
    }
    res.json({ publicKey: getVapidPublicKey() });
  });
}

export function registerPushRoutes(app) {
  app.post('/api/push/subscribe', requirePermission('shop_orders.view'), attachBranch, (req, res) => {
    try {
      if (!isPushEnabled()) {
        return res.status(503).json({ error: 'Push-уведомления не настроены на сервере' });
      }
      savePushSubscription(
        req.user.id,
        req.branchId,
        req.body?.subscription,
        req.headers['user-agent'],
      );
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/push/unsubscribe', requirePermission('shop_orders.view'), (req, res) => {
    try {
      removePushSubscription(req.user.id, req.body?.endpoint);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/admin/push/subscribers', requireAdmin, (req, res) => {
    try {
      if (!isPushEnabled()) {
        return res.status(503).json({ error: 'Push-уведомления не настроены на сервере' });
      }
      const branchId = req.query.branch_id || null;
      const rows = listPushSubscribers({ branchId, permission: 'shop_orders.view' });
      const byUser = new Map();
      for (const row of rows) {
        const key = row.user_id;
        if (!byUser.has(key)) {
          byUser.set(key, {
            user_id: row.user_id,
            username: row.username,
            name: row.name,
            branch_id: row.branch_id,
            branch_name: row.branch_name,
            devices: 0,
          });
        }
        byUser.get(key).devices += 1;
      }
      res.json({ items: [...byUser.values()], total: byUser.size, subscriptions: rows.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/admin/push/send', requireAdmin, async (req, res) => {
    try {
      if (!isPushEnabled()) {
        return res.status(503).json({ error: 'Push-уведомления не настроены на сервере' });
      }
      const result = await sendAdminPush({
        title: req.body?.title,
        body: req.body?.body,
        url: req.body?.url,
        branchId: req.body?.branch_id || null,
        userIds: req.body?.user_ids,
        target: req.body?.target || 'snab',
      });
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
}
