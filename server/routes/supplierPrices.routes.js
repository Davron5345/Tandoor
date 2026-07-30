import * as supplierPrices from '../services/supplierPrices.js';
import { requirePermission, requireAnyPermission, attachBranch } from '../middleware.js';
import { logAudit } from '../auditLog.js';

export function registerSupplierPriceRoutes(app) {
  app.get(
    '/api/supplier-prices',
    requireAnyPermission('products.view', 'documents.prihod'),
    attachBranch,
    (req, res) => {
      res.json(supplierPrices.listSupplierPriceDocuments(req.branchId));
    },
  );

  app.get(
    '/api/supplier-prices/:id',
    requireAnyPermission('products.view', 'documents.prihod'),
    attachBranch,
    (req, res) => {
      const doc = supplierPrices.getSupplierPriceDocument(req.params.id, req.branchId);
      if (!doc) return res.status(404).json({ error: 'Не найден' });
      res.json(doc);
    },
  );

  app.post(
    '/api/supplier-prices',
    requirePermission('products.edit'),
    attachBranch,
    (req, res) => {
      try {
        const doc = supplierPrices.createSupplierPriceDocument(req.body, req.user.id, req.branchId);
        logAudit(req, 'supplier_price.create', {
          entity_type: 'document',
          entity_id: doc.id,
          meta: { number: doc.number, supplier_id: doc.counterparty_id },
        });
        res.status(201).json(doc);
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    },
  );

  app.put(
    '/api/supplier-prices/:id',
    requirePermission('products.edit'),
    attachBranch,
    (req, res) => {
      try {
        const doc = supplierPrices.updateSupplierPriceDocument(
          req.params.id,
          req.body,
          req.branchId,
        );
        res.json(doc);
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    },
  );

  app.post(
    '/api/supplier-prices/:id/confirm',
    requirePermission('products.edit'),
    attachBranch,
    (req, res) => {
      try {
        const doc = supplierPrices.confirmSupplierPriceDocument(
          req.params.id,
          req.user.id,
          req.branchId,
        );
        logAudit(req, 'supplier_price.confirm', {
          entity_type: 'document',
          entity_id: doc.id,
          meta: { number: doc.number },
        });
        res.json(doc);
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    },
  );

  app.post(
    '/api/supplier-prices/:id/cancel',
    requirePermission('products.edit'),
    attachBranch,
    (req, res) => {
      try {
        const doc = supplierPrices.cancelSupplierPriceDocument(
          req.params.id,
          req.user.id,
          req.branchId,
        );
        logAudit(req, 'supplier_price.cancel', {
          entity_type: 'document',
          entity_id: doc.id,
          meta: { number: doc.number },
        });
        res.json(doc);
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    },
  );

  app.delete(
    '/api/supplier-prices/:id',
    requirePermission('products.edit'),
    attachBranch,
    (req, res) => {
      try {
        supplierPrices.deleteSupplierPriceDocument(req.params.id, req.branchId);
        res.json({ ok: true });
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    },
  );
}
