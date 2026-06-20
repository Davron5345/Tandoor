import * as svc from '../services.js';
import { getUsers, createUser, updateUser, deleteUser } from '../auth.js';
import { requirePermission, requireAdmin, attachBranch } from '../middleware.js';
import * as branches from '../branches.js';
import * as departments from '../departments.js';

export function registerOrgRoutes(app) {
  app.get('/api/stats', requirePermission('dashboard.view'), attachBranch, (req, res) => {
    res.json(svc.getStats(req.branchId));
  });

  app.get('/api/reports/stock', requirePermission('reports.view'), attachBranch, (req, res) => {
    const departmentId = req.query.department_id || null;
    const onlyInStock = req.query.only_in_stock !== '0';
    res.json(svc.getStockReport(req.branchId, departmentId, onlyInStock));
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

  app.get('/api/reports/pnl', requirePermission('reports.view'), attachBranch, (req, res) => {
    const dateFrom = req.query.date_from || null;
    const dateTo = req.query.date_to || null;
    res.json(svc.getPnLReport(req.branchId, dateFrom, dateTo));
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
      res.status(201).json(branches.enrichBranch(branches.createBranch(req.body)));
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
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/departments', attachBranch, (req, res) => {
    let branchFilter = null;
    if (req.query.branch_id) {
      branchFilter = req.query.branch_id;
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
    res.json(getUsers(req.user, req.branchId));
  });

  app.post('/api/users', requirePermission('users.edit'), (req, res) => {
    try {
      res.status(201).json(createUser(req.body));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.put('/api/users/:id', requirePermission('users.edit'), (req, res) => {
    try {
      res.json(updateUser(req.params.id, req.body));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete('/api/users/:id', requirePermission('users.edit'), (req, res) => {
    try {
      deleteUser(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
}
