import { attachBranch, requirePermission } from '../middleware.js';
import {
  getShopOrder,
  getShopOrders,
  getShopSettings,
  saveShopSettings,
  updateShopOrderStatus,
} from '../shopOrders.js';

export function registerShopOrdersRoutes(app) {
  app.get('/api/shop/settings', requirePermission('products.edit'), attachBranch, (req, res) => {
    res.json(getShopSettings(req.branchId));
  });

  app.put('/api/shop/settings', requirePermission('products.edit'), attachBranch, (req, res) => {
    try {
      res.json(saveShopSettings(req.branchId, req.body));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/shop-orders', requirePermission('products.view'), attachBranch, (req, res) => {
    res.json(getShopOrders(req.branchId, { status: req.query.status, limit: req.query.limit }));
  });

  app.get('/api/shop-orders/:id', requirePermission('products.view'), attachBranch, (req, res) => {
    const order = getShopOrder(req.params.id);
    if (!order || order.branch_id !== req.branchId) {
      return res.status(404).json({ error: 'Заказ не найден' });
    }
    res.json(order);
  });

  app.put('/api/shop-orders/:id/status', requirePermission('products.edit'), attachBranch, (req, res) => {
    try {
      const order = updateShopOrderStatus(req.params.id, req.body.status, req.branchId);
      res.json(order);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
}
