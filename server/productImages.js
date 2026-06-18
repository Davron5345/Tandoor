import { v4 as uuidv4 } from 'uuid';
import { existsSync, unlinkSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import db from './db.js';
import { uploadsDir } from './dbBackup.js';

const { queryAll, queryOne, run } = db;

export const MAX_PHOTOS = 5;
export const MAX_GIFS = 2;
export const VARIANT_MAX_PHOTOS = 5;
export const VARIANT_MAX_GIFS = 2;
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

const ALLOWED = {
  'image/jpeg': { ext: '.jpg', type: 'photo' },
  'image/png': { ext: '.png', type: 'photo' },
  'image/webp': { ext: '.webp', type: 'photo' },
  'image/gif': { ext: '.gif', type: 'gif' },
};

export function getUploadsRoot() {
  return uploadsDir;
}

export function getProductDir(productId) {
  return join(getUploadsRoot(), 'products', productId);
}

export function ensureProductDir(productId) {
  const root = getUploadsRoot();
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  const dir = getProductDir(productId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function isAllowedMime(mime) {
  return !!ALLOWED[mime];
}

export function getMediaType(mime) {
  return ALLOWED[mime]?.type || null;
}

export function extFromMime(mime) {
  return ALLOWED[mime]?.ext || '';
}

function enrichImage(row) {
  return {
    ...row,
    is_primary: !!row.is_primary,
    url: `/uploads/products/${row.product_id}/${row.file_name}`,
  };
}

function assertVariant(productId, variantId) {
  if (!variantId) return;
  const row = queryOne(
    'SELECT id FROM product_variants WHERE id = ? AND product_id = ?',
    [variantId, productId],
  );
  if (!row) throw new Error('Вариант не найден');
}

function imageScopeSql(variantId) {
  if (variantId) return 'product_id = ? AND variant_id = ?';
  return "product_id = ? AND (variant_id IS NULL OR variant_id = '')";
}

function imageScopeParams(productId, variantId) {
  return variantId ? [productId, variantId] : [productId];
}

export function countByType(productId, variantId = null) {
  const rows = queryAll(
    `SELECT media_type, COUNT(*) as c FROM product_images WHERE ${imageScopeSql(variantId)} GROUP BY media_type`,
    imageScopeParams(productId, variantId),
  );
  const counts = { photo: 0, gif: 0 };
  for (const row of rows) counts[row.media_type] = row.c;
  return counts;
}

export function getProductImages(productId, variantId = null) {
  const product = queryOne('SELECT id FROM products WHERE id = ?', [productId]);
  if (!product) throw new Error('Товар не найден');
  if (variantId) assertVariant(productId, variantId);

  return queryAll(`
    SELECT id, product_id, variant_id, file_name, original_name, mime_type, media_type, size, sort_order, is_primary, created_at
    FROM product_images
    WHERE ${imageScopeSql(variantId)}
    ORDER BY is_primary DESC, sort_order, created_at
  `, imageScopeParams(productId, variantId)).map(enrichImage);
}

export function registerUpload(productId, file, variantId = null) {
  if (!file) throw new Error('Файл не выбран');

  const product = queryOne('SELECT id FROM products WHERE id = ?', [productId]);
  if (!product) throw new Error('Товар не найден');
  if (variantId) assertVariant(productId, variantId);

  const mediaType = getMediaType(file.mimetype);
  if (!mediaType) {
    try { unlinkSync(file.path); } catch { /* ignore */ }
    throw new Error('Допустимы JPG, PNG, WEBP и GIF');
  }

  if (file.size > MAX_FILE_SIZE) {
    try { unlinkSync(file.path); } catch { /* ignore */ }
    throw new Error('Файл больше 10 МБ');
  }

  const counts = countByType(productId, variantId);
  const maxPhotos = variantId ? VARIANT_MAX_PHOTOS : MAX_PHOTOS;
  const maxGifs = variantId ? VARIANT_MAX_GIFS : MAX_GIFS;

  if (mediaType === 'photo' && counts.photo >= maxPhotos) {
    try { unlinkSync(file.path); } catch { /* ignore */ }
    throw new Error(`Максимум ${maxPhotos} фото`);
  }
  if (mediaType === 'gif' && counts.gif >= maxGifs) {
    try { unlinkSync(file.path); } catch { /* ignore */ }
    throw new Error(`Максимум ${maxGifs} GIF`);
  }

  const id = uuidv4();
  const sortOrder = queryOne(
    `SELECT COALESCE(MAX(sort_order), 0) + 1 as n FROM product_images WHERE ${imageScopeSql(variantId)}`,
    imageScopeParams(productId, variantId),
  ).n;
  const isPrimary = mediaType === 'photo' && counts.photo === 0 ? 1 : 0;

  run(`
    INSERT INTO product_images (id, product_id, variant_id, file_name, original_name, mime_type, media_type, size, sort_order, is_primary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
    productId,
    variantId || null,
    file.filename,
    file.originalname || file.filename,
    file.mimetype,
    mediaType,
    file.size,
    sortOrder,
    isPrimary,
  ]);

  return enrichImage(queryOne('SELECT * FROM product_images WHERE id = ?', [id]));
}

export function removeImageFile(row) {
  const path = join(getProductDir(row.product_id), row.file_name);
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch { /* ignore */ }
}

export function deleteProductImage(productId, imageId) {
  const row = queryOne('SELECT * FROM product_images WHERE id = ? AND product_id = ?', [imageId, productId]);
  if (!row) throw new Error('Изображение не найдено');
  const wasPrimary = !!row.is_primary;
  removeImageFile(row);
  run('DELETE FROM product_images WHERE id = ?', [imageId]);

  if (wasPrimary && row.media_type === 'photo') {
    const scopeSql = row.variant_id
      ? 'product_id = ? AND variant_id = ? AND media_type = ?'
      : "product_id = ? AND (variant_id IS NULL OR variant_id = '') AND media_type = ?";
    const scopeParams = row.variant_id
      ? [productId, row.variant_id, 'photo']
      : [productId, 'photo'];
    const next = queryOne(
      `SELECT id FROM product_images WHERE ${scopeSql} ORDER BY sort_order, created_at LIMIT 1`,
      scopeParams,
    );
    if (next) run('UPDATE product_images SET is_primary = 1 WHERE id = ?', [next.id]);
  }
}

export function setPrimaryProductImage(productId, imageId) {
  const row = queryOne('SELECT * FROM product_images WHERE id = ? AND product_id = ?', [imageId, productId]);
  if (!row) throw new Error('Изображение не найдено');
  if (row.media_type !== 'photo') throw new Error('Главным можно сделать только фото');

  const scopeSql = row.variant_id
    ? 'product_id = ? AND variant_id = ?'
    : "product_id = ? AND (variant_id IS NULL OR variant_id = '')";
  const scopeParams = row.variant_id ? [productId, row.variant_id] : [productId];

  run(`UPDATE product_images SET is_primary = 0 WHERE ${scopeSql}`, scopeParams);
  run('UPDATE product_images SET is_primary = 1 WHERE id = ?', [imageId]);
  return getProductImages(productId, row.variant_id || null);
}

export function deleteVariantImages(variantId) {
  const rows = queryAll('SELECT * FROM product_images WHERE variant_id = ?', [variantId]);
  for (const row of rows) removeImageFile(row);
  run('DELETE FROM product_images WHERE variant_id = ?', [variantId]);
}

export function deleteAllProductImages(productId) {
  const rows = queryAll('SELECT * FROM product_images WHERE product_id = ?', [productId]);
  for (const row of rows) removeImageFile(row);
  run('DELETE FROM product_images WHERE product_id = ?', [productId]);
  const dir = getProductDir(productId);
  try {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  } catch { /* ignore */ }
}
