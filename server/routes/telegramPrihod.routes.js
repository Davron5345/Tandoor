import * as telegramPrihod from '../services/telegramPrihod.js';
import { requirePermission, attachBranch } from '../middleware.js';
import { hasPermission } from '../permissions.js';
import { logAudit } from '../auditLog.js';

export function registerTelegramPrihodRoutes(app) {
  app.get('/api/telegram-prihod/inbox', requirePermission('documents.prihod'), attachBranch, (req, res) => {
    res.json(telegramPrihod.listInbox(req.branchId, req.query));
  });

  app.post('/api/telegram-prihod/inbox/:id/create', requirePermission('documents.prihod'), attachBranch, (req, res) => {
    try {
      if (req.body?.confirm && !hasPermission(req.user.role, 'documents.confirm')) {
        return res.status(403).json({ error: 'Нет права проводить документы' });
      }
      const result = telegramPrihod.createFromInbox(req.params.id, req.body || {}, req.user.id, req.branchId);
      logAudit(req, 'telegram_prihod.create', {
        entity_type: 'document',
        entity_id: result.document.id,
        meta: { number: result.document.number, inbox_id: req.params.id, confirmed: result.confirmed },
      });
      res.status(201).json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/telegram-prihod/inbox/create-ready', requirePermission('documents.prihod'), attachBranch, (req, res) => {
    try {
      res.json(telegramPrihod.createReadyFromInbox(req.branchId, req.user.id, req.body?.ids || null));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/telegram-prihod/inbox/:id/status', requirePermission('documents.prihod'), attachBranch, (req, res) => {
    try {
      res.json(telegramPrihod.setInboxStatus(req.params.id, req.body?.status, req.branchId));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/telegram-prihod/import-text', requirePermission('documents.prihod'), attachBranch, (req, res) => {
    try {
      res.json(telegramPrihod.importPastedText(req.branchId, req.body || {}));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/telegram-prihod/topics', requirePermission('documents.prihod'), attachBranch, (req, res) => {
    res.json(telegramPrihod.listTopics(req.branchId));
  });

  app.put('/api/telegram-prihod/topics/:id', requirePermission('telegram.settings'), attachBranch, (req, res) => {
    try {
      const topic = telegramPrihod.updateTopic(req.params.id, req.body || {}, req.branchId);
      logAudit(req, 'telegram_prihod.topic', {
        entity_type: 'telegram_topic',
        entity_id: req.params.id,
        meta: { mode: topic?.mode, department_id: topic?.department_id },
      });
      res.json(topic);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
}
