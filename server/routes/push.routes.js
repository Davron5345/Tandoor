import { requirePermission, attachBranch } from '../middleware.js';
import {
  getVapidPublicKey,
  isPushEnabled,
  savePushSubscription,
  removePushSubscription,
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
}
