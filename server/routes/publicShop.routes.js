import {
  getPublicBranches,
  getPublicCatalog,
  resolvePublicProductMedia,
} from '../publicShop.js';
import { createShopOrder } from '../shopOrders.js';

export function registerPublicShopRoutes(app) {
  app.get('/api/public/shop/branches', (_req, res) => {
    res.json(getPublicBranches());
  });

  app.get('/api/public/shop/:branchId/catalog', (req, res) => {
    try {
      res.json(getPublicCatalog(req.params.branchId));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/public/shop/:branchId/media/:productId/:fileName', (req, res) => {
    const filePath = resolvePublicProductMedia(
      req.params.branchId,
      req.params.productId,
      req.params.fileName,
    );
    if (!filePath) {
      return res.status(404).json({ error: 'Не найдено' });
    }
    return res.sendFile(filePath);
  });

  app.post('/api/public/shop/:branchId/orders', (req, res) => {
    try {
      const order = createShopOrder(req.params.branchId, req.body);
      res.status(201).json(order);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
}
