import * as svc from '../services.js';
import { requirePermission, requireAnyPermission, attachBranch } from '../middleware.js';

export function registerCounterpartyRoutes(app) {
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
      res.json(svc.getCounterpartyContracts(req.params.id, req.branchId));
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

  app.delete('/api/counterparties/:id/contracts/:contractId', requirePermission('counterparties.edit'), attachBranch, (req, res) => {
    try {
      svc.deleteCounterpartyContract(req.params.id, req.params.contractId, req.branchId);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
}
