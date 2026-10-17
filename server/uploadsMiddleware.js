import express from 'express';
import db from './db.js';
import { uploadsDir } from './dbBackup.js';
import { authOptional } from './middleware.js';
import { hasPermission } from './permissions.js';
import { getDocumentAttachment, isRegisteredInboxMedia } from './documentAttachments.js';

const { queryOne } = db;

const UPLOAD_VIEW_PERMISSIONS = [
  'products.view',
  'calculations.view',
  'documents.view',
  'documents.prihod',
  'documents.rashod',
  'documents.transfer',
  'documents.razdelka',
  'documents.inventory',
];

function canViewUploads(user) {
  if (!user) return false;
  return UPLOAD_VIEW_PERMISSIONS.some((perm) => hasPermission(user.role, perm));
}

function safeFileName(fileName) {
  return fileName && !fileName.includes('..') && !fileName.includes('/') && !fileName.includes('\\');
}

function parseProductUploadPath(path) {
  const match = path.match(/^\/products\/([^/]+)\/([^/]+)$/);
  if (!match) return null;
  if (!safeFileName(match[2])) return null;
  return { kind: 'product', productId: match[1], fileName: match[2] };
}

function parseDocumentUploadPath(path) {
  const match = path.match(/^\/documents\/([^/]+)\/([^/]+)$/);
  if (!match) return null;
  if (!safeFileName(match[2])) return null;
  return { kind: 'document', documentId: match[1], fileName: match[2] };
}

function parseInboxUploadPath(path) {
  const match = path.match(/^\/telegram-inbox\/([^/]+)\/([^/]+)$/);
  if (!match) return null;
  if (!safeFileName(match[2])) return null;
  return { kind: 'inbox', inboxId: match[1], fileName: match[2] };
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

    const product = parseProductUploadPath(req.path);
    if (product) {
      if (!isRegisteredProductImage(product.productId, product.fileName)) {
        return res.status(404).json({ error: 'Не найдено' });
      }
      return next();
    }

    const doc = parseDocumentUploadPath(req.path);
    if (doc) {
      if (!getDocumentAttachment(doc.documentId, doc.fileName)) {
        return res.status(404).json({ error: 'Не найдено' });
      }
      return next();
    }

    const inbox = parseInboxUploadPath(req.path);
    if (inbox) {
      if (!isRegisteredInboxMedia(inbox.inboxId, inbox.fileName)) {
        return res.status(404).json({ error: 'Не найдено' });
      }
      return next();
    }

    return res.status(404).json({ error: 'Не найдено' });
  });
  router.use(staticHandler);

  return router;
}
