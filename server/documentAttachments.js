import { v4 as uuidv4 } from 'uuid';
import { existsSync, mkdirSync, writeFileSync, unlinkSync, rmSync } from 'fs';
import { join } from 'path';
import db from './db.js';
import { uploadsDir } from './dbBackup.js';

const { queryAll, queryOne, run } = db;

export const MAX_DOC_ATTACHMENTS = 10;
export const MAX_DOC_FILE_SIZE = 12 * 1024 * 1024;

const ALLOWED = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
};

export function isAllowedDocMime(mime) {
  return !!ALLOWED[mime];
}

export function extFromDocMime(mime) {
  return ALLOWED[mime] || '';
}

export function getDocumentUploadsDir(documentId) {
  return join(uploadsDir, 'documents', documentId);
}

export function ensureDocumentUploadsDir(documentId) {
  if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });
  const dir = getDocumentUploadsDir(documentId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function enrich(row) {
  return {
    ...row,
    url: `/uploads/documents/${row.document_id}/${row.file_name}`,
  };
}

export function listDocumentAttachments(documentId) {
  return queryAll(
    `SELECT * FROM document_attachments WHERE document_id = ? ORDER BY created_at ASC, id ASC`,
    [documentId],
  ).map(enrich);
}

export function getDocumentAttachment(documentId, fileName) {
  return queryOne(
    'SELECT * FROM document_attachments WHERE document_id = ? AND file_name = ?',
    [documentId, fileName],
  );
}

export function countDocumentAttachments(documentId) {
  return Number(
    queryOne('SELECT COUNT(*) as c FROM document_attachments WHERE document_id = ?', [documentId])?.c || 0,
  );
}

/**
 * Сохранить вложение из буфера (фото Telegram / ручная загрузка).
 * @returns enriched attachment row
 */
export function saveDocumentAttachmentBuffer(documentId, buffer, {
  mimeType = 'image/jpeg',
  originalName = null,
  source = 'upload',
} = {}) {
  if (!documentId) throw new Error('Документ не указан');
  if (!buffer?.length) throw new Error('Пустой файл');
  if (buffer.length > MAX_DOC_FILE_SIZE) {
    throw new Error('Файл слишком большой (макс. 12 МБ)');
  }
  const mime = mimeType || 'application/octet-stream';
  if (!isAllowedDocMime(mime)) {
    throw new Error('Допустимы JPG, PNG, WEBP, GIF и PDF');
  }
  if (countDocumentAttachments(documentId) >= MAX_DOC_ATTACHMENTS) {
    throw new Error(`Не больше ${MAX_DOC_ATTACHMENTS} вложений на документ`);
  }

  const id = uuidv4();
  const ext = extFromDocMime(mime) || '';
  const fileName = `${id}${ext}`;
  const dir = ensureDocumentUploadsDir(documentId);
  writeFileSync(join(dir, fileName), buffer);

  const name = String(originalName || `source${ext}`).slice(0, 200);
  run(`
    INSERT INTO document_attachments (id, document_id, file_name, original_name, mime_type, size, source)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [id, documentId, fileName, name, mime, buffer.length, source || 'upload']);

  return enrich(queryOne('SELECT * FROM document_attachments WHERE id = ?', [id]));
}

export function deleteDocumentAttachment(documentId, attachmentId) {
  const row = queryOne(
    'SELECT * FROM document_attachments WHERE id = ? AND document_id = ?',
    [attachmentId, documentId],
  );
  if (!row) throw new Error('Вложение не найдено');
  const path = join(getDocumentUploadsDir(documentId), row.file_name);
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch { /* */ }
  run('DELETE FROM document_attachments WHERE id = ?', [attachmentId]);
  return true;
}

export function deleteAllDocumentAttachments(documentId) {
  const dir = getDocumentUploadsDir(documentId);
  run('DELETE FROM document_attachments WHERE document_id = ?', [documentId]);
  try {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  } catch { /* */ }
}
