import db, { reloadDb } from '../db.js';
import {
  backupDatabaseFile, listBackups, restoreDatabaseFromBackup, verifyDatabaseFile,
} from '../dbBackup.js';
import {
  roleExists, createRole, updateRole, deleteRole, getRolesWithStats,
  initPermissions, getPermissionsConfig, getRolePermissionsMatrix,
  matrixToPermissions, savePermissionsForRole, getPermissionsForRole,
  assertRoleBranchAccess,
} from '../permissions.js';
import { requireAdmin, attachBranch } from '../middleware.js';
import { canViewAllBranches } from '../branches.js';
import { seedDefaultUsers } from '../auth.js';
import * as departments from '../departments.js';
import { resetTestData } from '../resetTestData.js';
import { resetOperationalData } from '../resetOperationalData.js';
import { getAuditLog, AUDIT_ACTION_LABELS } from '../auditLog.js';
import {
  listActiveSessions,
  revokeSessionById,
  revokeUserSessions,
  listBlockedDevices,
  blockDevice,
  blockDeviceFromSession,
  unblockDevice,
} from '../sessions.js';
import { getVisitLog, VISIT_ACTION_LABELS } from '../visitLog.js';

export function registerAdminRoutes(app) {
  app.get('/api/admin/audit-log', requireAdmin, (req, res) => {
    const page = req.query.page || '1';
    const limit = req.query.limit || '50';
    res.json(getAuditLog({ ...req.query, page, limit }));
  });

  app.get('/api/admin/audit-log/actions', requireAdmin, (_req, res) => {
    res.json(
      Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => ({ value, label })),
    );
  });

  app.get('/api/admin/sessions', requireAdmin, (req, res) => {
    res.json(listActiveSessions(req.query, req.token));
  });

  app.delete('/api/admin/sessions/:id', requireAdmin, (req, res) => {
    try {
      revokeSessionById(req.params.id, req, { via: 'admin' });
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete('/api/admin/sessions/user/:userId', requireAdmin, (req, res) => {
    try {
      const count = revokeUserSessions(req.params.userId, req.token, req, 'admin');
      res.json({ ok: true, revoked: count });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/admin/sessions/:id/block-device', requireAdmin, (req, res) => {
    try {
      const blocked = blockDeviceFromSession(req.params.id, req.body?.reason, req);
      res.status(201).json(blocked);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/admin/devices/blocked', requireAdmin, (req, res) => {
    res.json(listBlockedDevices(req.query));
  });

  app.post('/api/admin/devices/block', requireAdmin, (req, res) => {
    try {
      const blocked = blockDevice(req.body || {}, req);
      res.status(201).json(blocked);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete('/api/admin/devices/blocked/:id', requireAdmin, (req, res) => {
    try {
      unblockDevice(req.params.id, req);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/admin/visits', requireAdmin, (req, res) => {
    const page = req.query.page || '1';
    const limit = req.query.limit || '50';
    res.json(getVisitLog({ ...req.query, page, limit }));
  });

  app.get('/api/admin/visits/actions', requireAdmin, (_req, res) => {
    res.json(
      Object.entries(VISIT_ACTION_LABELS).map(([value, label]) => ({ value, label })),
    );
  });

  app.post('/api/roles', requireAdmin, attachBranch, (req, res) => {
    try {
      const role = createRole(db, { ...req.body, branch_id: req.branchId });
      res.status(201).json(role);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/roles/list', requireAdmin, attachBranch, (req, res) => {
    const allBranches = canViewAllBranches(req.user, req.branchId);
    res.json(getRolesWithStats(db, { branchId: req.branchId, allBranches }));
  });

  app.put('/api/roles/:id', requireAdmin, attachBranch, (req, res) => {
    try {
      const allBranches = canViewAllBranches(req.user, req.branchId);
      assertRoleBranchAccess(req.params.id, req.branchId, { allBranches });
      const role = updateRole(db, req.params.id, req.body);
      res.json(role);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete('/api/roles/:id', requireAdmin, attachBranch, (req, res) => {
    try {
      const allBranches = canViewAllBranches(req.user, req.branchId);
      assertRoleBranchAccess(req.params.id, req.branchId, { allBranches });
      deleteRole(db, req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/roles/permissions/config', requireAdmin, (_, res) => {
    res.json(getPermissionsConfig());
  });

  app.get('/api/roles/:role/permissions', requireAdmin, attachBranch, (req, res) => {
    const role = req.params.role;
    if (!roleExists(role)) return res.status(404).json({ error: 'Роль не найдена' });
    const allBranches = canViewAllBranches(req.user, req.branchId);
    try {
      assertRoleBranchAccess(role, req.branchId, { allBranches });
    } catch (e) {
      return res.status(403).json({ error: e.message });
    }
    res.json({
      role,
      permissions: getPermissionsForRole(role),
      matrix: getRolePermissionsMatrix(role),
    });
  });

  app.put('/api/roles/:role/permissions', requireAdmin, attachBranch, (req, res) => {
    try {
      const role = req.params.role;
      if (!roleExists(role)) return res.status(404).json({ error: 'Роль не найдена' });
      const allBranches = canViewAllBranches(req.user, req.branchId);
      assertRoleBranchAccess(role, req.branchId, { allBranches });
      const permissions = req.body.matrix
        ? matrixToPermissions(req.body.matrix)
        : req.body.permissions;
      const saved = savePermissionsForRole(db, role, permissions);
      res.json({
        role,
        permissions: saved,
        matrix: getRolePermissionsMatrix(role),
      });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/admin/reset-operational-data', requireAdmin, (req, res) => {
    try {
      if (req.body?.confirm !== 'RESET_OPERATIONS') {
        return res.status(400).json({
          error: 'Опасная операция. Передайте confirm: "RESET_OPERATIONS" в теле запроса.',
        });
      }
      if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DATA_RESET !== 'true') {
        return res.status(403).json({
          error: 'Сброс данных в production отключён. Установите ALLOW_DATA_RESET=true',
        });
      }
      const result = resetOperationalData();
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/admin/reset-test-data', requireAdmin, (req, res) => {
    try {
      if (req.body?.confirm !== 'RESET_ALL_DATA') {
        return res.status(400).json({
          error: 'Опасная операция. Передайте confirm: "RESET_ALL_DATA" в теле запроса.',
        });
      }
      if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DATA_RESET !== 'true') {
        return res.status(403).json({
          error: 'Сброс данных в production отключён. Установите ALLOW_DATA_RESET=true',
        });
      }
      const result = resetTestData();
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/admin/backups', requireAdmin, (_req, res) => {
    res.json(listBackups());
  });

  app.post('/api/admin/backups', requireAdmin, (req, res) => {
    try {
      const reason = (req.body?.reason || 'manual').slice(0, 40);
      const backup = backupDatabaseFile(reason);
      if (!backup) return res.status(400).json({ error: 'База данных не найдена или пуста' });
      res.status(201).json(backup);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/admin/backups/verify', requireAdmin, async (_req, res) => {
    const current = await verifyDatabaseFile();
    res.json({ current });
  });

  app.post('/api/admin/backups/restore', requireAdmin, async (req, res) => {
    try {
      const { filename } = req.body || {};
      if (!filename) return res.status(400).json({ error: 'Укажите filename' });
      if (req.body?.confirm !== 'RESTORE') {
        return res.status(400).json({
          error: 'Передайте confirm: "RESTORE" для подтверждения восстановления',
        });
      }
      const result = await restoreDatabaseFromBackup(filename);
      await reloadDb();
      departments.migrateDepartmentStockSync();
      initPermissions(db);
      seedDefaultUsers();
      res.json({ ok: true, ...result, message: 'База восстановлена из бэкапа' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}
