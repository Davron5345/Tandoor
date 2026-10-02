import * as svc from '../services.js';
import { getUsers, createUser, updateUser, deleteUser, rotateUserLoginToken } from '../auth.js';
import { requirePermission, requireAdmin, attachBranch } from '../middleware.js';
import * as branches from '../branches.js';
import * as departments from '../departments.js';
import db from '../db.js';
import { reloadRoles, seedBranchRoles } from '../permissions.js';

import { logAudit } from '../auditLog.js';

export function registerOrgRoutes(app) {
  app.get('/api/stats', requirePermission('dashboard.view'), attachBranch, (req, res) => {
    res.json(svc.getStats(req.branchId));
  });

  app.get('/api/reports/stock', requirePermission('reports.view'), attachBranch, (req, res) => {
    const departmentId = req.query.department_id || null;
    const onlyInStock = req.query.only_in_stock !== '0';
    res.json(svc.getStockReport(req.branchId, departmentId, onlyInStock));
  });

  app.post('/api/reports/stock/zero', requireAdmin, attachBranch, (req, res) => {
    try {
      const result = svc.zeroStockPosition(req.branchId, req.body || {});
      logAudit(req, 'stock.zero', {
        entity_type: 'stock',
        entity_id: result.product_id,
        meta: {
          department_id: result.department_id,
          variant_id: result.variant_id,
          name: result.name,
          cleared_qty: result.cleared_qty,
        },
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/reports/debtors', requirePermission('reports.view'), attachBranch, (req, res) => {
    const includeZero = req.query.include_zero === '1';
    const includeUnlinked = req.query.include_unlinked_payments !== '0';
    res.json(svc.getDebtorsReport(req.branchId, includeZero, includeUnlinked));
  });

  app.get('/api/reports/creditors', requirePermission('reports.view'), attachBranch, (req, res) => {
    const includeZero = req.query.include_zero === '1';
    const includeUnlinked = req.query.include_unlinked_payments !== '0';
    res.json(svc.getCreditorsReport(req.branchId, includeZero, includeUnlinked));
  });

  app.get('/api/reports/liable-debts', requirePermission('reports.view'), attachBranch, (req, res) => {
    res.json(svc.getLiableDebtsReport(req.branchId, req.query.include_zero === '1'));
  });

  app.get('/api/reports/supplier-debts', requirePermission('reports.view'), attachBranch, (req, res) => {
    try {
      const dateFrom = req.query.date_from || null;
      const dateTo = req.query.date_to || null;
      const supplierIds = req.query.supplier_ids || req.query.supplier_id || null;
      const includeUnlinked = req.query.include_unlinked_payments !== '0';
      res.json(svc.getSupplierDebtMovementReport(
        req.branchId,
        dateFrom,
        dateTo,
        supplierIds,
        includeUnlinked,
      ));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/reports/pnl', requirePermission('reports.view'), attachBranch, (req, res) => {
    const dateFrom = req.query.date_from || null;
    const dateTo = req.query.date_to || null;
    res.json(svc.getPnLReport(req.branchId, dateFrom, dateTo));
  });

  app.get('/api/reports/cash-articles', requirePermission('reports.view'), attachBranch, (req, res) => {
    const dateFrom = req.query.date_from || null;
    const dateTo = req.query.date_to || null;
    res.json(svc.getCashArticlesReport(req.branchId, dateFrom, dateTo));
  });

  app.get('/api/reports/reconciliation', requirePermission('reports.view'), attachBranch, (req, res) => {
    try {
      res.json(svc.getReconciliationAct(req.branchId, req.query));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/reports/stock-movement', requirePermission('reports.view'), attachBranch, (req, res) => {
    try {
      res.json(svc.getStockMovementReport(req.branchId, req.query));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/reports/stock-movement/details', requirePermission('reports.view'), attachBranch, (req, res) => {
    try {
      res.json(svc.getStockMovementDetails(req.branchId, req.query));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/reports/reconciliation-marks', requirePermission('reports.view'), attachBranch, (req, res) => {
    try {
      res.json(svc.getReconciliationMarks(req.branchId, req.query));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/reports/reconciliation-marks', requirePermission('reports.view'), attachBranch, (req, res) => {
    try {
      const mark = svc.createReconciliationMark(req.branchId, req.body || {}, req.user.id);
      logAudit(req, 'reconciliation.mark', {
        entity_type: 'counterparty',
        entity_id: mark.counterparty_id,
        meta: { mark_id: mark.id, date: mark.date, balance: mark.balance },
      });
      res.status(201).json(mark);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete('/api/reports/reconciliation-marks/:id', requirePermission('reports.view'), attachBranch, (req, res) => {
    try {
      const mark = svc.deleteReconciliationMark(req.branchId, req.params.id, req.user);
      logAudit(req, 'reconciliation.unmark', {
        entity_type: 'counterparty',
        entity_id: mark.counterparty_id,
        meta: { mark_id: mark.id, date: mark.date, balance: mark.balance },
      });
      res.json({ ok: true });
    } catch (e) {
      res.status(e.status || 400).json({ error: e.message });
    }
  });

  app.get('/api/branches', attachBranch, (req, res) => {
    if (req.user.role === 'admin') {
      res.json(branches.getBranchesEnriched(true));
      return;
    }
    const branch = branches.getBranch(req.branchId);
    res.json(branch ? [branches.enrichBranch(branch)] : []);
  });

  app.post('/api/branches', requireAdmin, (req, res) => {
    try {
      const branch = branches.createBranch(req.body);
      seedBranchRoles(db, branch.id);
      res.status(201).json(branches.enrichBranch(branch));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.put('/api/branches/:id', requireAdmin, (req, res) => {
    try {
      res.json(branches.enrichBranch(branches.updateBranch(req.params.id, req.body)));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete('/api/branches/:id', requireAdmin, (req, res) => {
    try {
      branches.deleteBranch(req.params.id);
      reloadRoles(db);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/departments', attachBranch, (req, res) => {
    let branchFilter = null;
    const rawBranch = req.query.branch_id;
    // qs: дублирующий branch_id → массив; берём первую строку
    const queryBranch = Array.isArray(rawBranch) ? rawBranch[0] : rawBranch;
    if (queryBranch) {
      branchFilter = String(queryBranch);
    } else if (req.user?.role !== 'admin') {
      branchFilter = req.branchId;
    }
    res.json(departments.getDepartmentsEnriched(branchFilter, req.query.active === '1'));
  });

  app.post('/api/departments', requireAdmin, (req, res) => {
    try {
      res.status(201).json(departments.enrichDepartment(departments.createDepartment(req.body)));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.put('/api/departments/:id', requireAdmin, (req, res) => {
    try {
      res.json(departments.enrichDepartment(departments.updateDepartment(req.params.id, req.body)));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete('/api/departments/:id', requireAdmin, (req, res) => {
    try {
      departments.deleteDepartment(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/users', requirePermission('users.view'), attachBranch, (req, res) => {
    const allBranches = branches.canViewAllBranches(req.user, req.branchId);
    res.json(getUsers(req.user, req.branchId, { allBranches }));
  });

  app.post('/api/users', requirePermission('users.edit'), attachBranch, (req, res) => {
    try {
      res.status(201).json(createUser(req.body, req.user));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.put('/api/users/:id', requirePermission('users.edit'), attachBranch, (req, res) => {
    try {
      res.json(updateUser(req.params.id, req.body, req.user));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/users/:id/login-link', requirePermission('users.edit'), attachBranch, (req, res) => {
    try {
      const user = rotateUserLoginToken(req.params.id, req.user);
      logAudit(req, 'users.login_link_rotate', { entity_type: 'user', entity_id: req.params.id, meta: { username: user.username } });
      res.json(user);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete('/api/users/:id', requirePermission('users.edit'), attachBranch, (req, res) => {
    try {
      deleteUser(req.params.id, req.user);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
}
