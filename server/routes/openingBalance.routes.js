import { requirePermission, attachBranch } from '../middleware.js';
import { logAudit } from '../auditLog.js';
import { getBusinessBalanceSummary, getMoneyBalances } from '../openingBalance.js';
import {
  listOpeningBalanceDocuments,
  getOpeningBalanceDocument,
  createOpeningBalanceDocument,
  updateOpeningBalanceDocument,
  confirmOpeningBalanceDocument,
  cancelOpeningBalanceDocument,
  deleteOpeningBalanceDocument,
} from '../services/openingBalanceDocuments.js';

export function registerOpeningBalanceRoutes(app) {
  app.get('/api/opening-balance', requirePermission('opening_balance.view'), attachBranch, (req, res) => {
    res.json({
      summary: getBusinessBalanceSummary(req.branchId),
      money: getMoneyBalances(req.branchId),
      documents: listOpeningBalanceDocuments(req.branchId),
    });
  });

  app.get('/api/opening-balance/documents', requirePermission('opening_balance.view'), attachBranch, (req, res) => {
    res.json(listOpeningBalanceDocuments(req.branchId));
  });

  app.get('/api/opening-balance/documents/:id', requirePermission('opening_balance.view'), attachBranch, (req, res) => {
    const doc = getOpeningBalanceDocument(req.params.id, req.branchId);
    if (!doc) return res.status(404).json({ error: 'Документ не найден' });
    res.json(doc);
  });

  app.post('/api/opening-balance/documents', requirePermission('opening_balance.edit'), attachBranch, (req, res) => {
    try {
      const doc = createOpeningBalanceDocument(req.body, req.user.id, req.branchId);
      logAudit(req, 'opening_balance.create', {
        entity_type: 'document',
        entity_id: doc.id,
        meta: { number: doc.number, date: doc.date },
      });
      res.status(201).json(doc);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.put('/api/opening-balance/documents/:id', requirePermission('opening_balance.edit'), attachBranch, (req, res) => {
    try {
      const doc = updateOpeningBalanceDocument(req.params.id, req.body, req.user.id, req.branchId);
      res.json(doc);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/opening-balance/documents/:id/confirm', requirePermission('opening_balance.edit'), attachBranch, (req, res) => {
    try {
      const doc = confirmOpeningBalanceDocument(req.params.id, req.user.id, req.branchId);
      logAudit(req, 'opening_balance.confirm', {
        entity_type: 'document',
        entity_id: doc.id,
        meta: { number: doc.number, date: doc.date },
      });
      res.json(doc);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/opening-balance/documents/:id/cancel', requirePermission('opening_balance.edit'), attachBranch, (req, res) => {
    try {
      const doc = cancelOpeningBalanceDocument(req.params.id, req.user.id, req.branchId);
      logAudit(req, 'opening_balance.cancel', {
        entity_type: 'document',
        entity_id: doc.id,
        meta: { number: doc.number },
      });
      res.json(doc);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete('/api/opening-balance/documents/:id', requirePermission('opening_balance.edit'), attachBranch, (req, res) => {
    try {
      res.json(deleteOpeningBalanceDocument(req.params.id, req.branchId));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/reports/business-balance', requirePermission('reports.view'), attachBranch, (req, res) => {
    res.json(getBusinessBalanceSummary(req.branchId));
  });
}
