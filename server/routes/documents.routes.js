import db from '../db.js';
import * as svc from '../services.js';
import { sendDocumentNotification } from '../telegram.js';
import { canAccessDocumentType } from '../permissions.js';
import { requirePermission, requireAnyPermission, attachBranch } from '../middleware.js';
import {
  filterDocumentsForUser,
  filterTransfersForDepartment,
  assertDocumentTypeAccess,
  assertDocumentBranchAccess,
  assertDocumentDepartmentAccess,
  assertDocumentMutableInBranch,
  applyDepartmentScopedTransferBody,
  isDepartmentScopedUser,
} from '../documentAccess.js';
import { parsePagination, paginateList, stripPaginationParams } from '../pagination.js';
import { logAudit } from '../auditLog.js';
import { getDishRecipes, previewDishSaleLine } from '../dishSales.js';

const DOC_READ_PERMS = [
  'documents.view', 'documents.prihod', 'documents.rashod', 'documents.dish_sale',
  'documents.transfer', 'documents.razdelka', 'documents.inventory',
];

function buildDocumentListFilters(req) {
  const filters = {
    ...stripPaginationParams(req.query),
    branch_id: req.branchId,
  };
  if (isDepartmentScopedUser(req.user) && filters.type === 'peremeshchenie') {
    filters.involving_department_id = req.user.department_id;
    if (!['in', 'out'].includes(filters.direction)) {
      delete filters.direction;
    }
  }
  return filters;
}

export function registerDocumentRoutes(app) {
  app.get('/api/documents/next-number', requireAnyPermission('documents.view', 'documents.prihod', 'documents.rashod', 'documents.dish_sale', 'documents.transfer', 'documents.inventory', 'documents.edit'), attachBranch, (req, res) => {
    try {
      const type = req.query.type;
      if (!type) return res.status(400).json({ error: 'Укажите type' });
      res.json({ number: svc.getNextDocNumber(req.branchId, type) });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/documents/inventory/stock', requirePermission('documents.inventory'), attachBranch, (req, res) => {
    try {
      res.json(svc.getInventoryStockSnapshot(
        req.query.department_id,
        req.branchId,
        req.query.product_id || null,
        req.query.variant_id || null,
      ));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/documents', requireAnyPermission(...DOC_READ_PERMS), attachBranch, (req, res) => {
    const docs = svc.getDocuments(buildDocumentListFilters(req));
    const filtered = filterTransfersForDepartment(
      filterDocumentsForUser(docs, req.user.role),
      req.user,
    );
    const amountSum = filtered.reduce((sum, d) => sum + (Number(d.total_amount) || 0), 0);
    const pagination = parsePagination(req.query);
    if (pagination) {
      res.json({ ...paginateList(filtered, pagination), amount_sum: amountSum });
      return;
    }
    res.json(filtered);
  });

  app.get('/api/dish-recipes', requirePermission('documents.dish_sale'), attachBranch, (req, res) => {
    res.json(getDishRecipes(req.branchId));
  });

  app.post('/api/dish-sales/preview', requirePermission('documents.dish_sale'), attachBranch, (req, res) => {
    try {
      res.json(previewDishSaleLine(req.body, req.body.department_id, req.branchId));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/documents/:id', requireAnyPermission(...DOC_READ_PERMS), attachBranch, (req, res) => {
    const doc = svc.getDocument(req.params.id, req.branchId);
    if (!doc) return res.status(404).json({ error: 'Не найден' });
    if (!canAccessDocumentType(req.user.role, doc.type)) {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }
    try {
      assertDocumentBranchAccess(req.user, doc, req.branchId);
      assertDocumentDepartmentAccess(req.user, doc);
    } catch (e) {
      return res.status(403).json({ error: e.message });
    }
    res.json(doc);
  });

  app.post('/api/documents', requirePermission('documents.edit'), attachBranch, async (req, res) => {
    try {
      const body = applyDepartmentScopedTransferBody(req.body, req.user, req.branchId);
      assertDocumentTypeAccess(req.user.role, body.type);
      const doc = svc.createDocument(body, req.user.id, req.branchId);
      if (doc.status === 'confirmed') {
        logAudit(req, 'document.confirm', {
          entity_type: 'document',
          entity_id: doc.id,
          meta: { type: doc.type, number: doc.number, via: 'create' },
        });
      }
      if (doc.status === 'confirmed' && doc.counterparty_id) {
        const cp = db.queryOne('SELECT * FROM counterparties WHERE id = ?', [doc.counterparty_id]);
        if (cp?.telegram_chat_id) {
          await sendDocumentNotification(doc, cp);
        }
      }
      res.status(201).json(doc);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.put('/api/documents/:id', requirePermission('documents.edit'), attachBranch, async (req, res) => {
    try {
      const existing = svc.getDocument(req.params.id, req.branchId);
      if (!existing) return res.status(404).json({ error: 'Не найден' });
      assertDocumentTypeAccess(req.user.role, req.body.type || existing.type);
      assertDocumentBranchAccess(req.user, existing, req.branchId);
      assertDocumentDepartmentAccess(req.user, existing);
      assertDocumentMutableInBranch(existing, req.branchId, req.user);
      const body = existing.type === 'peremeshchenie'
        ? applyDepartmentScopedTransferBody({
          ...req.body,
          type: 'peremeshchenie',
          to_department_id: req.body.to_department_id ?? existing.to_department_id,
        }, req.user, req.branchId)
        : req.body;
      const doc = svc.updateDocument(req.params.id, body, req.user.id, req.branchId);
      res.json(doc);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/documents/:id/confirm', requirePermission('documents.confirm'), attachBranch, async (req, res) => {
    try {
      const existing = svc.getDocument(req.params.id, req.branchId);
      if (!existing) return res.status(404).json({ error: 'Не найден' });
      assertDocumentTypeAccess(req.user.role, existing.type);
      assertDocumentBranchAccess(req.user, existing, req.branchId);
      assertDocumentDepartmentAccess(req.user, existing);
      assertDocumentMutableInBranch(existing, req.branchId, req.user);
      const doc = svc.confirmDocument(req.params.id, req.user.id);
      logAudit(req, 'document.confirm', {
        entity_type: 'document',
        entity_id: doc.id,
        meta: { type: doc.type, number: doc.number },
      });
      if (doc.counterparty_id) {
        const cp = db.queryOne('SELECT * FROM counterparties WHERE id = ?', [doc.counterparty_id]);
        if (cp?.telegram_chat_id) {
          await sendDocumentNotification(doc, cp);
        }
      }
      res.json(doc);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/documents/:id/cancel', requirePermission('documents.edit'), attachBranch, (req, res) => {
    try {
      const existing = svc.getDocument(req.params.id, req.branchId);
      if (!existing) return res.status(404).json({ error: 'Не найден' });
      assertDocumentTypeAccess(req.user.role, existing.type);
      assertDocumentBranchAccess(req.user, existing, req.branchId);
      assertDocumentDepartmentAccess(req.user, existing);
      assertDocumentMutableInBranch(existing, req.branchId, req.user);
      const doc = svc.cancelDocument(req.params.id, req.user.id);
      logAudit(req, 'document.cancel', {
        entity_type: 'document',
        entity_id: doc.id,
        meta: { type: doc.type, number: doc.number },
      });
      res.json(doc);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete('/api/documents/:id', requirePermission('documents.delete'), attachBranch, (req, res) => {
    try {
      const existing = svc.getDocument(req.params.id, req.branchId);
      if (!existing) return res.status(404).json({ error: 'Не найден' });
      assertDocumentTypeAccess(req.user.role, existing.type);
      assertDocumentBranchAccess(req.user, existing, req.branchId);
      assertDocumentDepartmentAccess(req.user, existing);
      assertDocumentMutableInBranch(existing, req.branchId, req.user);
      res.json(svc.deleteDocument(req.params.id));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/documents/:id/history', requireAnyPermission(...DOC_READ_PERMS), attachBranch, (req, res) => {
    const doc = svc.getDocument(req.params.id, req.branchId);
    if (!doc) return res.status(404).json({ error: 'Не найден' });
    if (!canAccessDocumentType(req.user.role, doc.type)) {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }
    try {
      assertDocumentBranchAccess(req.user, doc, req.branchId);
      assertDocumentDepartmentAccess(req.user, doc);
    } catch (e) {
      return res.status(403).json({ error: e.message });
    }
    const history = svc.getDocumentHistory(req.params.id).map((h) => ({
      ...h,
      snapshot: JSON.parse(h.snapshot),
    }));
    res.json(history);
  });
}
