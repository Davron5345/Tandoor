import multer from 'multer';
import * as svc from '../services.js';
import { requirePermission, requireAnyPermission, attachBranch } from '../middleware.js';
import { getConfirmedOpeningTotals } from '../services/openingBalanceDocuments.js';

const statementUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase();
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) cb(null, true);
    else cb(new Error('Загрузите файл Excel (.xlsx) выписки AccReferenceReport'));
  },
});

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

  app.get('/api/payments/shift-summary', requireAnyPermission(
    'cashier.view', 'cashier.edit', 'cashier.delete',
    'payments.view', 'payments.edit',
  ), attachBranch, (req, res) => {
    try {
      const date = req.query.date;
      if (!date) return res.status(400).json({ error: 'Укажите date' });
      res.json(svc.getCashShiftSummary(req.branchId, date));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post(
    '/api/payments/import/parse',
    requirePermission('payments.edit'),
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
        res.json(svc.previewBankStatement(req.file.buffer, req.branchId));
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    },
  );

  app.post('/api/payments/import/confirm', requirePermission('payments.edit'), attachBranch, (req, res) => {
    try {
      const rows = req.body?.rows;
      res.status(201).json(
        svc.confirmBankStatementImport(rows, req.user.id, req.branchId, req.user.role),
      );
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/payments', requireAnyPermission(
    'cashier.view', 'cashier.edit', 'cashier.delete',
    'payments.view', 'payments.edit',
  ), attachBranch, (req, res) => {
    res.json(svc.getPayments(req.branchId, req.user.role, req.query));
  });

  /** Начальное сальдо банка (из проведённого НС) для выписок по дням */
  app.get('/api/payments/bank-opening', requireAnyPermission(
    'cashier.view', 'cashier.edit', 'cashier.delete',
    'payments.view', 'payments.edit',
  ), attachBranch, (req, res) => {
    const opening = getConfirmedOpeningTotals(req.branchId);
    res.json({
      opening_bank: opening.bank || 0,
      start_date: opening.start_date || null,
    });
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
