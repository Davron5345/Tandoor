import { requirePermission, attachBranch } from '../middleware.js';
import { logAudit } from '../auditLog.js';
import {
  getBusinessBalanceSummary,
  getBranchOpeningSettings,
  saveBranchOpeningSettings,
  getOpeningStockLines,
  saveOpeningStock,
  saveCounterpartyOpeningBalances,
  getCurrentCashBalance,
} from '../openingBalance.js';
import { getCounterparties } from '../services/counterparties.js';

export function registerOpeningBalanceRoutes(app) {
  app.get('/api/opening-balance', requirePermission('opening_balance.view'), attachBranch, (req, res) => {
    const branchId = req.branchId;
    res.json({
      summary: getBusinessBalanceSummary(branchId),
      settings: getBranchOpeningSettings(branchId),
      cash: getCurrentCashBalance(branchId),
      counterparties: getCounterparties(null, branchId).map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        phone: c.phone || '',
        opening_balance: c.opening_balance || 0,
      })),
    });
  });

  app.get('/api/opening-balance/stock', requirePermission('opening_balance.view'), attachBranch, (req, res) => {
    const departmentId = req.query.department_id || null;
    res.json(getOpeningStockLines(req.branchId, departmentId));
  });

  app.put('/api/opening-balance/settings', requirePermission('opening_balance.edit'), attachBranch, (req, res) => {
    try {
      const settings = saveBranchOpeningSettings(req.branchId, req.body || {});
      logAudit(req, 'opening_balance.settings', {
        entity_type: 'branch',
        entity_id: req.branchId,
        meta: { as_of_date: settings.as_of_date, cash_balance: settings.cash_balance },
      });
      res.json(settings);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.put('/api/opening-balance/stock', requirePermission('opening_balance.edit'), attachBranch, (req, res) => {
    try {
      const { department_id, lines } = req.body || {};
      const result = saveOpeningStock(req.branchId, department_id, lines);
      logAudit(req, 'opening_balance.stock', {
        entity_type: 'department',
        entity_id: department_id,
        meta: { lines: lines?.length || 0 },
      });
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.put('/api/opening-balance/counterparties', requirePermission('opening_balance.edit'), attachBranch, (req, res) => {
    try {
      const items = saveCounterpartyOpeningBalances(req.branchId, req.body?.items || []);
      logAudit(req, 'opening_balance.counterparties', {
        entity_type: 'branch',
        entity_id: req.branchId,
        meta: { count: items.length },
      });
      res.json({ items });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/reports/business-balance', requirePermission('reports.view'), attachBranch, (req, res) => {
    res.json(getBusinessBalanceSummary(req.branchId));
  });
}
