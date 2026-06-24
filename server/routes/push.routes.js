import { requirePermission, attachBranch, requireAdmin } from '../middleware.js';
import {
  getVapidPublicKey,
  isPushEnabled,
  savePushSubscription,
  removePushSubscription,
  listPushSubscribers,
  listPushRecipients,
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
      const audience = req.query.audience === 'all' ? null : 'shop_orders.view';
      const onlySubscribed = req.query.only_subscribed === '1';
      const items = listPushRecipients({ branchId, permission: audience, onlySubscribed });
      const subscribedUsers = items.filter((row) => row.subscribed).length;
      const subscriptions = items.reduce((sum, row) => sum + row.devices, 0);
      res.json({
        items,
        total: items.length,
        subscribed_users: subscribedUsers,
        subscriptions,
      });
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
