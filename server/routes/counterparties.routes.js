import multer from 'multer';
import * as svc from '../services.js';
import { requirePermission, requireAnyPermission, attachBranch } from '../middleware.js';

const statementUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase();
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) cb(null, true);
    else cb(new Error('Загрузите файл Excel (.xlsx) выписки AccReferenceReport'));
  },
});

export function registerCounterpartyRoutes(app) {
  app.post(
    '/api/counterparties/from-statement/parse',
    requireAnyPermission('counterparties.view', 'counterparties.edit'),
    attachBranch,
    (req, res, next) => {
      statementUpload.single('file')(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        next();
      });
    },
    (req, res) => {
      try {
        if (!req.file?.buffer?.length) {
          return res.status(400).json({ error: 'Прикрепите файл выписки (.xlsx)' });
        }
        res.json(svc.previewStatementRequisites(req.file.buffer, req.branchId));
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    },
  );

  app.post(
    '/api/counterparties/from-statement/parse-text',
    requireAnyPermission('counterparties.view', 'counterparties.edit'),
    attachBranch,
    (req, res) => {
      try {
        const text = String(req.body?.text || '');
        if (!text.trim()) {
          return res.status(400).json({ error: 'Вставьте текст выписки' });
        }
        res.json(svc.previewStatementRequisitesText(text, req.branchId));
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    },
  );

  app.post(
    '/api/counterparties/from-statement/apply',
    requirePermission('counterparties.edit'),
    attachBranch,
    (req, res) => {
      try {
        res.status(201).json(svc.applyStatementRequisites(req.body?.items || [], req.branchId));
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    },
  );

  app.get('/api/counterparties', requireAnyPermission(
    'counterparties.view', 'counterparties.edit',
    'payments.view', 'payments.edit',
    'cashier.view', 'cashier.edit',
  ), attachBranch, (req, res) => {
    res.json(svc.getCounterparties(req.query.type, req.branchId));
  });

  app.post('/api/counterparties', requirePermission('counterparties.edit'), attachBranch, (req, res) => {
    try {
      res.status(201).json(svc.createCounterparty(req.body, req.branchId));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.put('/api/counterparties/:id', requirePermission('counterparties.edit'), attachBranch, (req, res) => {
    try {
      res.json(svc.updateCounterparty(req.params.id, req.body, req.branchId));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete('/api/counterparties/:id', requirePermission('counterparties.edit'), attachBranch, (req, res) => {
    try {
      svc.deleteCounterparty(req.params.id, req.branchId);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/counterparties/:id/contracts', requireAnyPermission('counterparties.view', 'counterparties.edit', 'documents.view', 'documents.edit'), attachBranch, (req, res) => {
    try {
      res.json(svc.getCounterpartyContracts(req.params.id, req.branchId, {
        firmId: req.query.firm_id || null,
      }));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/counterparties/:id/contracts', requirePermission('counterparties.edit'), attachBranch, (req, res) => {
    try {
      res.status(201).json(svc.createCounterpartyContract(req.params.id, req.body, req.branchId));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.put('/api/counterparties/:id/contracts/:contractId', requirePermission('counterparties.edit'), attachBranch, (req, res) => {
    try {
      res.json(svc.updateCounterpartyContract(req.params.id, req.params.contractId, req.body, req.branchId));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete('/api/counterparties/:id/contracts/:contractId', requirePermission('counterparties.edit'), attachBranch, (req, res) => {
    try {
      svc.deleteCounterpartyContract(req.params.id, req.params.contractId, req.branchId);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/counterparties/:id/firms', requireAnyPermission(
    'counterparties.view', 'counterparties.edit', 'documents.view', 'documents.edit', 'payments.view', 'payments.edit',
  ), attachBranch, (req, res) => {
    try {
      res.json(svc.getCounterpartyFirms(req.params.id, req.branchId));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/counterparties/:id/firms', requirePermission('counterparties.edit'), attachBranch, (req, res) => {
    try {
      res.status(201).json(svc.createCounterpartyFirm(req.params.id, req.body, req.branchId));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.put('/api/counterparties/:id/firms/:firmId', requirePermission('counterparties.edit'), attachBranch, (req, res) => {
    try {
      res.json(svc.updateCounterpartyFirm(req.params.id, req.params.firmId, req.body, req.branchId));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete('/api/counterparties/:id/firms/:firmId', requirePermission('counterparties.edit'), attachBranch, (req, res) => {
    try {
      svc.deleteCounterpartyFirm(req.params.id, req.params.firmId, req.branchId);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
}
