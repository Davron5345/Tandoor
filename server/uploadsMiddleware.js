import express from 'express';
import db from './db.js';
import { uploadsDir } from './dbBackup.js';
import { authOptional } from './middleware.js';
import { hasPermission } from './permissions.js';

const { queryOne } = db;

const UPLOAD_VIEW_PERMISSIONS = [
  'products.view',
  'calculations.view',
  'documents.view',
  'documents.prihod',
  'documents.rashod',
  'documents.transfer',
  'documents.razdelka',
];

function canViewUploads(user) {
  if (!user) return false;
  return UPLOAD_VIEW_PERMISSIONS.some((perm) => hasPermission(user.role, perm));
}

function parseProductUploadPath(path) {
  const match = path.match(/^\/products\/([^/]+)\/([^/]+)$/);
  if (!match) return null;

  const fileName = match[2];
  if (!fileName || fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
    return null;
  }

  return { productId: match[1], fileName };
}

function isRegisteredProductImage(productId, fileName) {
  const row = queryOne(
    'SELECT id FROM product_images WHERE product_id = ? AND file_name = ?',
    [productId, fileName],
  );
  return !!row;
}

export function createProtectedUploadsRouter() {
  const router = express.Router();
  const staticHandler = express.static(uploadsDir, { fallthrough: false });

  router.use(authOptional);
  router.use((req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Требуется авторизация' });
    }
    if (!canViewUploads(req.user)) {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }

    const parsed = parseProductUploadPath(req.path);
    if (!parsed) {
      return res.status(404).json({ error: 'Не найдено' });
    }
    if (!isRegisteredProductImage(parsed.productId, parsed.fileName)) {
      return res.status(404).json({ error: 'Не найдено' });
    }

    next();
  });
  router.use(staticHandler);

  return router;
}
