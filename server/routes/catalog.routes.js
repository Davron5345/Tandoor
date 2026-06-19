import * as svc from '../services.js';
import * as calculations from '../calculations.js';
import * as productImages from '../productImages.js';
import { requirePermission, requireAdmin, attachBranch } from '../middleware.js';

export function registerCatalogRoutes(app, { productImageUpload }) {
  app.get('/api/product-categories', requirePermission('products.view'), (_, res) => {
    res.json(svc.getProductCategories());
  });

  app.post('/api/product-categories', requirePermission('products.edit'), (req, res) => {
    try {
      res.status(201).json(svc.createProductCategory(req.body));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.put('/api/product-categories/:id', requirePermission('products.edit'), (req, res) => {
    try {
      res.json(svc.updateProductCategory(req.params.id, req.body));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete('/api/product-categories/:id', requirePermission('products.edit'), (req, res) => {
    try {
      svc.deleteProductCategory(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/products', requirePermission('products.view'), attachBranch, (req, res) => {
    res.json(svc.getProducts({ ...req.query, branch_id: req.branchId }));
  });

  app.get('/api/products/:id/branch-settings', requireAdmin, (req, res) => {
    try {
      res.json(svc.getProductBranchSettings(req.params.id));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/products', requirePermission('products.edit'), attachBranch, (req, res) => {
    try {
      res.status(201).json(svc.createProduct({ ...req.body, branch_id: req.branchId }));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.put('/api/products/:id', requirePermission('products.edit'), attachBranch, (req, res) => {
    try {
      const isAdmin = req.user.role === 'admin';
      res.json(svc.updateProduct(req.params.id, req.body, req.branchId, { isAdmin }));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete('/api/products/:id', requirePermission('products.edit'), (req, res) => {
    try {
      svc.deleteProduct(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/products/:productId/variants/:variantId/archive', requirePermission('products.edit'), attachBranch, (req, res) => {
    try {
      res.json(svc.archiveProductVariant(req.params.productId, req.params.variantId, req.branchId));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/products/:id/images', requirePermission('products.view'), (req, res) => {
    try {
      const variantId = req.query.variant_id || null;
      res.json(productImages.getProductImages(req.params.id, variantId));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/products/:id/images', requirePermission('products.edit'), (req, res) => {
    productImageUpload.single('file')(req, res, (err) => {
      if (err) {
        const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Файл больше 10 МБ' : err.message;
        return res.status(400).json({ error: msg });
      }
      try {
        const variantId = req.query.variant_id || null;
        res.status(201).json(productImages.registerUpload(req.params.id, req.file, variantId));
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    });
  });

  app.delete('/api/products/:id/images/:imageId', requirePermission('products.edit'), (req, res) => {
    try {
      productImages.deleteProductImage(req.params.id, req.params.imageId);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.put('/api/products/:id/images/:imageId/primary', requirePermission('products.edit'), (req, res) => {
    try {
      res.json(productImages.setPrimaryProductImage(req.params.id, req.params.imageId));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/calculations', requirePermission('calculations.view'), attachBranch, (req, res) => {
    const activeOnly = req.query.active === '1';
    res.json(calculations.getCalculations(req.branchId, activeOnly));
  });

  app.get('/api/calculations/:id', requirePermission('calculations.view'), attachBranch, (req, res) => {
    const calc = calculations.getCalculation(req.params.id, req.branchId);
    if (!calc) return res.status(404).json({ error: 'Не найдено' });
    res.json(calc);
  });

  app.post('/api/calculations/:id/apply', requirePermission('calculations.view'), attachBranch, (req, res) => {
    try {
      const result = calculations.applyCalculation(
        req.params.id,
        req.body.input_quantity,
        req.body.input_price,
        req.branchId,
      );
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/calculations', requirePermission('calculations.edit'), attachBranch, (req, res) => {
    try {
      res.status(201).json(calculations.createCalculation(req.body, req.branchId));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.put('/api/calculations/:id', requirePermission('calculations.edit'), attachBranch, (req, res) => {
    try {
      res.json(calculations.updateCalculation(req.params.id, req.body, req.branchId));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete('/api/calculations/:id', requirePermission('calculations.edit'), attachBranch, (req, res) => {
    try {
      calculations.deleteCalculation(req.params.id, req.branchId);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
}
