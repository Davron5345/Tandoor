import multer from 'multer';
import { requireAdmin, requireAnyPermission, attachBranch } from '../middleware.js';
import * as payroll from '../services/faceidPayroll.js';
import { importPayrollEmployeesFromExcelBuffer } from '../services/payrollEmployeesImport.js';

function todayIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function registerPublicFaceIdRoutes(app) {
  // Face ID (или шлюз) шлёт отметки приход/уход
  app.post('/api/integrations/faceid/events', (req, res) => {
    try {
      const branchHint = req.query.branch_id || req.body?.branch_id || null;
      const branchId = payroll.verifyFaceIdWebhook(req, branchHint);
      const events = Array.isArray(req.body?.events) ? req.body.events : [req.body];
      const results = [];
      for (const ev of events) {
        if (!ev || typeof ev !== 'object') continue;
        results.push(payroll.recordAttendanceEvent(branchId, ev));
      }
      if (!results.length) {
        return res.status(400).json({ error: 'Пустое событие' });
      }
      res.json(results.length === 1 ? results[0] : { items: results });
    } catch (e) {
      const status = /ключ|Неверный/i.test(e.message) ? 403 : 400;
      res.status(status).json({ error: e.message });
    }
  });
}

export function registerFaceIdPayrollRoutes(app) {
  const canCashier = requireAnyPermission('cashier.view', 'cashier.edit', 'payments.view', 'payments.edit', 'users.view', 'users.edit');
  const canPay = requireAnyPermission('cashier.edit', 'payments.edit');
  const canImportEmployees = requireAnyPermission('users.edit', 'cashier.edit');

  app.get('/api/faceid/settings', requireAdmin, attachBranch, (req, res) => {
    const cfg = payroll.getFaceIdConfig(req.branchId);
    res.json({
      ...cfg,
      device_key_set: Boolean(cfg.device_key),
      webhook_secret_set: Boolean(cfg.webhook_secret),
      // не светим секреты целиком
      device_key: cfg.device_key ? '••••••••' : '',
      webhook_secret: cfg.webhook_secret ? '••••••••' : '',
      webhook_url: `${req.protocol}://${req.get('host')}/api/integrations/faceid/events?branch_id=${encodeURIComponent(req.branchId)}`,
    });
  });

  app.put('/api/faceid/settings', requireAdmin, attachBranch, (req, res) => {
    try {
      const body = req.body || {};
      const patch = {
        enabled: body.enabled,
        base_url: body.base_url,
      };
      if (body.device_key && !String(body.device_key).includes('•')) {
        patch.device_key = body.device_key;
      }
      if (body.webhook_secret && !String(body.webhook_secret).includes('•')) {
        patch.webhook_secret = body.webhook_secret;
      }
      if (body.clear_device_key) patch.device_key = '';
      if (body.clear_webhook_secret) patch.webhook_secret = '';
      const cfg = payroll.saveFaceIdConfig(req.branchId, patch);
      res.json({
        ...cfg,
        device_key_set: Boolean(cfg.device_key),
        webhook_secret_set: Boolean(cfg.webhook_secret),
        device_key: cfg.device_key ? '••••••••' : '',
        webhook_secret: cfg.webhook_secret ? '••••••••' : '',
        webhook_url: `${req.protocol}://${req.get('host')}/api/integrations/faceid/events?branch_id=${encodeURIComponent(req.branchId)}`,
      });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/faceid/sync/employees', requireAnyPermission('cashier.edit', 'payments.edit', 'users.edit'), attachBranch, async (req, res) => {
    try {
      const result = await payroll.syncFaceIdEmployees(req.branchId);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/faceid/sync/attendance', requireAnyPermission('cashier.edit', 'payments.edit', 'users.edit'), attachBranch, async (req, res) => {
    try {
      const from = req.body?.from || req.query.from;
      const to = req.body?.to || req.query.to;
      const result = await payroll.syncFaceIdAttendance(req.branchId, { from, to });
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/payroll/employees/import', requireAdmin, attachBranch, (req, res) => {
    try {
      const employees = Array.isArray(req.body?.employees)
        ? req.body.employees
        : (Array.isArray(req.body) ? req.body : null);
      if (!employees) {
        return res.status(400).json({ error: 'Передайте { employees: [...] }' });
      }
      res.status(201).json(payroll.importPayrollEmployees(req.branchId, employees));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  const employeesXlsxUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 12 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const name = String(file.originalname || '').toLowerCase();
      if (name.endsWith('.xlsx') || name.endsWith('.xls')) cb(null, true);
      else cb(new Error('Загрузите Excel (.xlsx) по шаблону сотрудников Face ID'));
    },
  });

  app.post(
    '/api/payroll/employees/import-xlsx',
    canImportEmployees,
    attachBranch,
    (req, res, next) => {
      employeesXlsxUpload.single('file')(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message || 'Ошибка загрузки файла' });
        next();
      });
    },
    (req, res) => {
      try {
        if (!req.file?.buffer) {
          return res.status(400).json({ error: 'Прикрепите файл Excel (.xlsx)' });
        }
        const scope = String(req.query.scope || req.body?.scope || 'all');
        const result = importPayrollEmployeesFromExcelBuffer(req.file.buffer, {
          createMissingBranches: scope !== 'branch',
          onlyBranchId: scope === 'branch' ? req.branchId : null,
        });
        res.status(201).json(result);
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    },
  );

  app.get('/api/payroll/employees', canCashier, attachBranch, (req, res) => {
    try {
      res.json(payroll.listPayrollEmployees(req.branchId, {
        presentOnly: req.query.present === '1',
        date: req.query.date || null,
      }));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/payroll/attendance/recent', canCashier, attachBranch, (req, res) => {
    try {
      res.json(payroll.listRecentAttendance(req.branchId, Number(req.query.limit) || 30));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/payroll/employees/:id/ledger', canCashier, attachBranch, (req, res) => {
    try {
      res.json(payroll.listPayrollLedger(req.params.id, req.branchId, Number(req.query.limit) || 50));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/payroll/employees/:id/accrue', canPay, attachBranch, (req, res) => {
    try {
      const result = payroll.accruePayroll(req.params.id, req.body?.amount, {
        branchId: req.branchId,
        date: req.body?.date || todayIso(),
        comment: req.body?.comment || '',
        userId: req.user?.id,
      });
      res.status(201).json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/payroll/employees/:id/pay', canPay, attachBranch, (req, res) => {
    try {
      const result = payroll.payPayroll(req.params.id, {
        branchId: req.branchId,
        pay_amount: req.body?.pay_amount ?? req.body?.amount,
        accrue_amount: req.body?.accrue_amount ?? 0,
        date: req.body?.date || todayIso(),
        comment: req.body?.comment || '',
        userId: req.user?.id,
        userRole: req.user?.role,
      });
      res.status(201).json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
}
