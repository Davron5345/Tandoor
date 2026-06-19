import * as svc from '../services.js';
import { requirePermission, requireAnyPermission, attachBranch } from '../middleware.js';

export function registerFinanceRoutes(app) {
  app.get('/api/cash-articles', requireAnyPermission(
    'cashier.view', 'cashier.edit', 'payments.view', 'payments.edit',
  ), attachBranch, (req, res) => {
    res.json(svc.getCashArticles(req.query.direction || null, req.branchId));
  });

  app.get('/api/cash-articles/all', requirePermission('cash_articles.view'), attachBranch, (req, res) => {
    res.json(svc.getCashArticlesAll(req.branchId));
  });

  app.post('/api/cash-articles', requirePermission('cash_articles.edit'), attachBranch, (req, res) => {
    try {
      res.status(201).json(svc.createCashArticle(req.body, req.branchId));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.put('/api/cash-articles/:id', requirePermission('cash_articles.edit'), attachBranch, (req, res) => {
    try {
      res.json(svc.updateCashArticle(req.params.id, req.body, req.branchId));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete('/api/cash-articles/:id', requirePermission('cash_articles.edit'), attachBranch, (req, res) => {
    try {
      res.json(svc.deleteCashArticle(req.params.id, req.branchId));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/payments', requireAnyPermission(
    'cashier.view', 'cashier.edit', 'cashier.delete',
    'payments.view', 'payments.edit',
  ), attachBranch, (req, res) => {
    res.json(svc.getPayments(req.branchId));
  });

  app.post('/api/payments', requireAnyPermission('cashier.edit', 'payments.edit'), attachBranch, (req, res) => {
    try {
      res.status(201).json(svc.createPayment(req.body, req.user.id, req.branchId, req.user.role));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.put('/api/payments/:id', requireAnyPermission('cashier.edit', 'payments.edit'), attachBranch, (req, res) => {
    try {
      res.json(svc.updatePayment(req.params.id, req.body, req.branchId, req.user.role));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete('/api/payments/:id', requireAnyPermission('cashier.delete', 'payments.delete'), attachBranch, (req, res) => {
    try {
      svc.deletePayment(req.params.id, req.user.role, req.branchId);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
}
