import db from '../db.js';
import * as svc from '../services.js';
import { sendDocumentNotification } from '../telegram.js';
import { canAccessDocumentType } from '../permissions.js';
import { requirePermission, requireAnyPermission, attachBranch } from '../middleware.js';
import {
  filterDocumentsForUser,
  assertDocumentTypeAccess,
  assertDocumentBranchAccess,
} from '../documentAccess.js';
import { parsePagination, paginateList, stripPaginationParams } from '../pagination.js';
import { logAudit } from '../auditLog.js';
import { getDishRecipes, previewDishSaleLine } from '../dishSales.js';

export function registerDocumentRoutes(app) {
  app.get('/api/documents/next-number', requireAnyPermission('documents.view', 'documents.prihod', 'documents.rashod', 'documents.dish_sale', 'documents.transfer', 'documents.edit'), attachBranch, (req, res) => {
    try {
      const type = req.query.type;
      if (!type) return res.status(400).json({ error: 'Укажите type' });
      res.json({ number: svc.getNextDocNumber(req.branchId, type) });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/documents', requireAnyPermission('documents.view', 'documents.prihod', 'documents.rashod', 'documents.dish_sale', 'documents.transfer', 'documents.razdelka'), attachBranch, (req, res) => {
    const docs = svc.getDocuments({
      ...stripPaginationParams(req.query),
      branch_id: req.branchId,
    });
    const filtered = filterDocumentsForUser(docs, req.user.role);
    const pagination = parsePagination(req.query);
    res.json(pagination ? paginateList(filtered, pagination) : filtered);
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

  app.get('/api/documents/:id', requireAnyPermission('documents.view', 'documents.prihod', 'documents.rashod', 'documents.dish_sale', 'documents.transfer', 'documents.razdelka'), attachBranch, (req, res) => {
    const doc = svc.getDocument(req.params.id, req.branchId);
    if (!doc) return res.status(404).json({ error: 'Не найден' });
    if (!canAccessDocumentType(req.user.role, doc.type)) {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }
    try {
      assertDocumentBranchAccess(req.user, doc);
    } catch (e) {
      return res.status(403).json({ error: e.message });
    }
    res.json(doc);
  });

  app.post('/api/documents', requirePermission('documents.edit'), attachBranch, async (req, res) => {
    try {
      assertDocumentTypeAccess(req.user.role, req.body.type);
      const doc = svc.createDocument(req.body, req.user.id, req.branchId);
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
      assertDocumentBranchAccess(req.user, existing);
      const doc = svc.updateDocument(req.params.id, req.body, req.user.id, req.branchId);
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
      assertDocumentBranchAccess(req.user, existing);
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
      assertDocumentBranchAccess(req.user, existing);
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
      assertDocumentBranchAccess(req.user, existing);
      res.json(svc.deleteDocument(req.params.id));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/documents/:id/history', requireAnyPermission('documents.view', 'documents.prihod', 'documents.rashod', 'documents.transfer', 'documents.razdelka'), attachBranch, (req, res) => {
    const doc = svc.getDocument(req.params.id, req.branchId);
    if (!doc) return res.status(404).json({ error: 'Не найден' });
    if (!canAccessDocumentType(req.user.role, doc.type)) {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }
    try {
      assertDocumentBranchAccess(req.user, doc);
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
