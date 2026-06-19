import db from '../db.js';
import * as svc from '../services.js';
import { initTelegram, stopTelegram, isTelegramEnabled, sendDocumentNotification, sendCustomMessage } from '../telegram.js';
import { requirePermission, attachBranch } from '../middleware.js';
import {
  assertDocumentTypeAccess,
  assertDocumentBranchAccess,
  assertCounterpartyBranchAccess,
} from '../documentAccess.js';

export function registerTelegramRoutes(app) {
  app.get('/api/telegram/status', requirePermission('telegram.view'), (_, res) => {
    res.json({ enabled: isTelegramEnabled() });
  });

  app.get('/api/telegram/settings', requirePermission('telegram.settings'), (_, res) => {
    res.json({
      ...svc.getTelegramSettings(),
      enabled: isTelegramEnabled(),
    });
  });

  app.put('/api/telegram/settings', requirePermission('telegram.settings'), async (req, res) => {
    try {
      const { token } = req.body;
      svc.saveTelegramToken(token);
      await initTelegram(token);
      res.json({
        ...svc.getTelegramSettings(),
        enabled: isTelegramEnabled(),
      });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete('/api/telegram/settings', requirePermission('telegram.settings'), async (_, res) => {
    try {
      await stopTelegram();
      svc.removeTelegramToken();
      res.json({
        ...svc.getTelegramSettings(),
        enabled: false,
      });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/telegram/messages', requirePermission('telegram.view'), attachBranch, (req, res) => {
    res.json(svc.getTelegramMessages(50, req.branchId));
  });

  app.post('/api/telegram/send', requirePermission('telegram.send'), attachBranch, async (req, res) => {
    const { counterparty_id, message, document_id } = req.body;
    const cp = db.queryOne('SELECT * FROM counterparties WHERE id = ?', [counterparty_id]);
    if (!cp) return res.status(404).json({ error: 'Контрагент не найден' });

    try {
      assertCounterpartyBranchAccess(req.user, cp, req.branchId);
      if (document_id) {
        const doc = svc.getDocument(document_id);
        if (!doc) return res.status(404).json({ error: 'Документ не найден' });
        assertDocumentTypeAccess(req.user.role, doc.type);
        assertDocumentBranchAccess(req.user, doc);
      }
    } catch (e) {
      return res.status(403).json({ error: e.message });
    }

    const result = await sendCustomMessage(cp, message, document_id || null);
    if (result.success) {
      res.json({ ok: true });
    } else {
      res.status(400).json({ error: result.error });
    }
  });

  app.post('/api/telegram/send-document/:id', requirePermission('telegram.send'), attachBranch, async (req, res) => {
    const doc = svc.getDocument(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Документ не найден' });
    if (!doc.counterparty_id) return res.status(400).json({ error: 'У документа нет контрагента' });

    try {
      assertDocumentTypeAccess(req.user.role, doc.type);
      assertDocumentBranchAccess(req.user, doc);
    } catch (e) {
      return res.status(403).json({ error: e.message });
    }

    const cp = db.queryOne('SELECT * FROM counterparties WHERE id = ?', [doc.counterparty_id]);
    const result = await sendDocumentNotification(doc, cp);
    if (result.success) {
      res.json({ ok: true });
    } else {
      res.status(400).json({ error: result.error });
    }
  });
}
