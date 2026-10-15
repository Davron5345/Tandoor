import {
  getOpenRouterSettings,
  saveOpenRouterSettings,
  refreshOpenRouterModels,
} from '../services/openRouter.js';
import { requirePermission } from '../middleware.js';

export function registerAiRoutes(app) {
  app.get('/api/ai/settings', requirePermission('telegram.settings'), (_req, res) => {
    res.json(getOpenRouterSettings());
  });

  app.put('/api/ai/settings', requirePermission('telegram.settings'), (req, res) => {
    try {
      const result = saveOpenRouterSettings({
        api_key: req.body?.api_key,
        clear_api_key: !!req.body?.clear_api_key,
        model: req.body?.model,
      });
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/ai/models/refresh', requirePermission('telegram.settings'), async (_req, res) => {
    try {
      const result = await refreshOpenRouterModels();
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/ai/models', requirePermission('telegram.settings'), (_req, res) => {
    const s = getOpenRouterSettings();
    res.json({
      models: s.models,
      models_updated_at: s.models_updated_at,
      model: s.model,
    });
  });
}
