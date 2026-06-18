import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import db, { reloadDb } from './db.js';
import {
  backupDatabaseFile, listBackups, restoreDatabaseFromBackup, verifyDatabaseFile, dbPath, uploadsDir,
} from './dbBackup.js';
import * as svc from './services.js';
import { initTelegram, stopTelegram, isTelegramEnabled, sendDocumentNotification, sendCustomMessage } from './telegram.js';
import { login, logout, getUserByToken, getUsers, createUser, updateUser, deleteUser, seedDefaultUsers } from './auth.js';
import { getRoles, roleExists, createRole, updateRole, deleteRole, getRolesWithStats, hasPermission, canAccessDocumentType, initPermissions, getPermissionsConfig, getRolePermissionsMatrix, matrixToPermissions, savePermissionsForRole, getPermissionsForRole } from './permissions.js';
import { authRequired, requirePermission, requireAnyPermission, requireAdmin, attachBranch } from './middleware.js';
import * as branches from './branches.js';
import * as departments from './departments.js';
import * as calculations from './calculations.js';
import * as productImages from './productImages.js';
import { resetTestData } from './resetTestData.js';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadsDir));

const productImageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      try {
        cb(null, productImages.ensureProductDir(req.params.id));
      } catch (e) {
        cb(e);
      }
    },
    filename: (_req, file, cb) => {
      const ext = productImages.extFromMime(file.mimetype) || '';
      cb(null, `${uuidv4()}${ext}`);
    },
  }),
  limits: { fileSize: productImages.MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (productImages.isAllowedMime(file.mimetype)) cb(null, true);
    else cb(new Error('Допустимы JPG, PNG, WEBP и GIF'));
  },
});

function filterDocumentsForUser(docs, role) {
  if (hasPermission(role, 'documents.view') && hasPermission(role, 'documents.prihod') && hasPermission(role, 'documents.rashod')) {
    return docs;
  }
  return docs.filter((d) => canAccessDocumentType(role, d.type));
}

function assertDocumentTypeAccess(role, type) {
  if (!canAccessDocumentType(role, type)) {
    throw new Error('Недостаточно прав для этого типа документа');
  }
}

function assertDocumentBranchAccess(user, doc) {
  if (user.role === 'admin') return;
  const branchId = user.branch_id;
  if (!branchId) throw new Error('Сотрудник не привязан к филиалу');
  const allowed = doc.branch_id === branchId
    || doc.from_branch_id === branchId
    || doc.to_branch_id === branchId;
  if (!allowed) throw new Error('Нет доступа к документу этого филиала');
}

// Public
app.get('/api/health', (_, res) => {
  res.json({ ok: true, telegram: isTelegramEnabled() });
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body;
    res.json(login(username, password));
  } catch (e) {
    res.status(401).json({ error: e.message });
  }
});

// Protected API
app.use('/api', authRequired);

app.get('/api/auth/me', (req, res) => {
  res.json(req.user);
});

app.post('/api/auth/logout', (req, res) => {
  logout(req.token);
  res.json({ ok: true });
});

app.get('/api/auth/roles', (_, res) => {
  res.json(getRoles());
});

app.post('/api/roles', requireAdmin, (req, res) => {
  try {
    const role = createRole(db, req.body);
    res.status(201).json(role);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/roles/list', requireAdmin, (_, res) => {
  res.json(getRolesWithStats(db));
});

app.put('/api/roles/:id', requireAdmin, (req, res) => {
  try {
    const role = updateRole(db, req.params.id, req.body);
    res.json(role);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/roles/:id', requireAdmin, (req, res) => {
  try {
    deleteRole(db, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/roles/permissions/config', requireAdmin, (_, res) => {
  res.json(getPermissionsConfig());
});

app.get('/api/roles/:role/permissions', requireAdmin, (req, res) => {
  const role = req.params.role;
  if (!roleExists(role)) return res.status(404).json({ error: 'Роль не найдена' });
  res.json({
    role,
    permissions: getPermissionsForRole(role),
    matrix: getRolePermissionsMatrix(role),
  });
});

app.put('/api/roles/:role/permissions', requireAdmin, (req, res) => {
  try {
    const role = req.params.role;
    if (!roleExists(role)) return res.status(404).json({ error: 'Роль не найдена' });
    const permissions = req.body.matrix
      ? matrixToPermissions(req.body.matrix)
      : req.body.permissions;
    const saved = savePermissionsForRole(db, role, permissions);
    res.json({
      role,
      permissions: saved,
      matrix: getRolePermissionsMatrix(role),
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/admin/reset-test-data', requireAdmin, (req, res) => {
  try {
    if (req.body?.confirm !== 'RESET_ALL_DATA') {
      return res.status(400).json({
        error: 'Опасная операция. Передайте confirm: "RESET_ALL_DATA" в теле запроса.',
      });
    }
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DATA_RESET !== 'true') {
      return res.status(403).json({
        error: 'Сброс данных в production отключён. Установите ALLOW_DATA_RESET=true',
      });
    }
    const result = resetTestData();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/backups', requireAdmin, (_req, res) => {
  res.json(listBackups());
});

app.post('/api/admin/backups', requireAdmin, (req, res) => {
  try {
    const reason = (req.body?.reason || 'manual').slice(0, 40);
    const backup = backupDatabaseFile(reason);
    if (!backup) return res.status(400).json({ error: 'База данных не найдена или пуста' });
    res.status(201).json(backup);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/backups/verify', requireAdmin, async (_req, res) => {
  const current = await verifyDatabaseFile();
  res.json({ current });
});

app.post('/api/admin/backups/restore', requireAdmin, async (req, res) => {
  try {
    const { filename } = req.body || {};
    if (!filename) return res.status(400).json({ error: 'Укажите filename' });
    if (req.body?.confirm !== 'RESTORE') {
      return res.status(400).json({
        error: 'Передайте confirm: "RESTORE" для подтверждения восстановления',
      });
    }
    const result = await restoreDatabaseFromBackup(filename);
    await reloadDb();
    departments.migrateDepartmentStockSync();
    initPermissions(db);
    seedDefaultUsers();
    res.json({ ok: true, ...result, message: 'База восстановлена из бэкапа' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/stats', requirePermission('dashboard.view'), attachBranch, (req, res) => {
  res.json(svc.getStats(req.branchId));
});

app.get('/api/reports/stock', requirePermission('reports.view'), attachBranch, (req, res) => {
  const departmentId = req.query.department_id || null;
  const onlyInStock = req.query.only_in_stock !== '0';
  res.json(svc.getStockReport(req.branchId, departmentId, onlyInStock));
});

app.get('/api/reports/debtors', requirePermission('reports.view'), attachBranch, (req, res) => {
  const includeZero = req.query.include_zero === '1';
  const includeUnlinked = req.query.include_unlinked_payments !== '0';
  res.json(svc.getDebtorsReport(req.branchId, includeZero, includeUnlinked));
});

app.get('/api/reports/creditors', requirePermission('reports.view'), attachBranch, (req, res) => {
  const includeZero = req.query.include_zero === '1';
  const includeUnlinked = req.query.include_unlinked_payments !== '0';
  res.json(svc.getCreditorsReport(req.branchId, includeZero, includeUnlinked));
});

// Branches
app.get('/api/branches', attachBranch, (_, res) => {
  res.json(branches.getBranchesEnriched(true));
});

app.post('/api/branches', requireAdmin, (req, res) => {
  try {
    res.status(201).json(branches.enrichBranch(branches.createBranch(req.body)));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/branches/:id', requireAdmin, (req, res) => {
  try {
    res.json(branches.enrichBranch(branches.updateBranch(req.params.id, req.body)));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/branches/:id', requireAdmin, (req, res) => {
  try {
    branches.deleteBranch(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Departments
app.get('/api/departments', attachBranch, (req, res) => {
  let branchFilter = null;
  if (req.query.branch_id) {
    branchFilter = req.query.branch_id;
  } else if (req.user?.role !== 'admin') {
    branchFilter = req.branchId;
  }
  res.json(departments.getDepartmentsEnriched(branchFilter, req.query.active === '1'));
});

app.post('/api/departments', requireAdmin, (req, res) => {
  try {
    res.status(201).json(departments.enrichDepartment(departments.createDepartment(req.body)));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/departments/:id', requireAdmin, (req, res) => {
  try {
    res.json(departments.enrichDepartment(departments.updateDepartment(req.params.id, req.body)));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/departments/:id', requireAdmin, (req, res) => {
  try {
    departments.deleteDepartment(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Users
app.get('/api/users', requirePermission('users.view'), (_, res) => {
  res.json(getUsers());
});

app.post('/api/users', requirePermission('users.edit'), (req, res) => {
  try {
    res.status(201).json(createUser(req.body));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/users/:id', requirePermission('users.edit'), (req, res) => {
  try {
    res.json(updateUser(req.params.id, req.body));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/users/:id', requirePermission('users.edit'), (req, res) => {
  try {
    deleteUser(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Products
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

app.post('/api/products', requirePermission('products.edit'), attachBranch, (req, res) => {
  try {
    res.status(201).json(svc.createProduct({ ...req.body, branch_id: req.branchId }));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/products/:id', requirePermission('products.edit'), attachBranch, (req, res) => {
  try {
    res.json(svc.updateProduct(req.params.id, req.body, req.branchId));
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

// Calculations (калькуляции разделки)
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

// Counterparties
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

// Documents
app.get('/api/documents/next-number', requireAnyPermission('documents.view', 'documents.prihod', 'documents.rashod', 'documents.transfer', 'documents.edit'), attachBranch, (req, res) => {
  try {
    const type = req.query.type;
    if (!type) return res.status(400).json({ error: 'Укажите type' });
    res.json({ number: svc.getNextDocNumber(req.branchId, type) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/documents', requireAnyPermission('documents.view', 'documents.prihod', 'documents.rashod', 'documents.transfer', 'documents.razdelka'), attachBranch, (req, res) => {
  let docs = svc.getDocuments({ ...req.query, branch_id: req.branchId });
  docs = filterDocumentsForUser(docs, req.user.role);
  res.json(docs);
});

app.get('/api/documents/:id', requireAnyPermission('documents.view', 'documents.prihod', 'documents.rashod', 'documents.transfer', 'documents.razdelka'), attachBranch, (req, res) => {
  const doc = svc.getDocument(req.params.id, req.branchId);
  if (!doc) return res.status(404).json({ error: 'Не найден' });
  if (!canAccessDocumentType(req.user.role, doc.type)) {
    return res.status(403).json({ error: 'Недостаточно прав' });
  }
  try {
    assertDocumentBranchAccess(req.user, doc);
  } catch (e) {
    return res.status(403).json({ error: e.message });
  }
  res.json(doc);
});

app.post('/api/documents', requirePermission('documents.edit'), attachBranch, async (req, res) => {
  try {
    assertDocumentTypeAccess(req.user.role, req.body.type);
    const doc = svc.createDocument(req.body, req.user.id, req.branchId);
    if (doc.status === 'confirmed' && doc.counterparty_id) {
      const cp = db.queryOne('SELECT * FROM counterparties WHERE id = ?', [doc.counterparty_id]);
      if (cp?.telegram_chat_id) {
        await sendDocumentNotification(doc, cp);
      }
    }
    res.status(201).json(doc);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/documents/:id', requirePermission('documents.edit'), attachBranch, async (req, res) => {
  try {
    const existing = svc.getDocument(req.params.id, req.branchId);
    if (!existing) return res.status(404).json({ error: 'Не найден' });
    assertDocumentTypeAccess(req.user.role, req.body.type || existing.type);
    assertDocumentBranchAccess(req.user, existing);
    const doc = svc.updateDocument(req.params.id, req.body, req.user.id, req.branchId);
    res.json(doc);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/documents/:id/confirm', requirePermission('documents.confirm'), attachBranch, async (req, res) => {
  try {
    const existing = svc.getDocument(req.params.id, req.branchId);
    if (!existing) return res.status(404).json({ error: 'Не найден' });
    assertDocumentTypeAccess(req.user.role, existing.type);
    assertDocumentBranchAccess(req.user, existing);
    const doc = svc.confirmDocument(req.params.id, req.user.id);
    if (doc.counterparty_id) {
      const cp = db.queryOne('SELECT * FROM counterparties WHERE id = ?', [doc.counterparty_id]);
      if (cp?.telegram_chat_id) {
        await sendDocumentNotification(doc, cp);
      }
    }
    res.json(doc);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/documents/:id/cancel', requirePermission('documents.edit'), attachBranch, (req, res) => {
  try {
    const existing = svc.getDocument(req.params.id, req.branchId);
    if (!existing) return res.status(404).json({ error: 'Не найден' });
    assertDocumentTypeAccess(req.user.role, existing.type);
    assertDocumentBranchAccess(req.user, existing);
    res.json(svc.cancelDocument(req.params.id, req.user.id));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/documents/:id', requirePermission('documents.delete'), attachBranch, (req, res) => {
  try {
    const existing = svc.getDocument(req.params.id, req.branchId);
    if (!existing) return res.status(404).json({ error: 'Не найден' });
    assertDocumentTypeAccess(req.user.role, existing.type);
    assertDocumentBranchAccess(req.user, existing);
    res.json(svc.deleteDocument(req.params.id));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/documents/:id/history', requireAnyPermission('documents.view', 'documents.prihod', 'documents.rashod', 'documents.transfer', 'documents.razdelka'), attachBranch, (req, res) => {
  const doc = svc.getDocument(req.params.id, req.branchId);
  if (!doc) return res.status(404).json({ error: 'Не найден' });
  if (!canAccessDocumentType(req.user.role, doc.type)) {
    return res.status(403).json({ error: 'Недостаточно прав' });
  }
  try {
    assertDocumentBranchAccess(req.user, doc);
  } catch (e) {
    return res.status(403).json({ error: e.message });
  }
  const history = svc.getDocumentHistory(req.params.id).map((h) => ({
    ...h,
    snapshot: JSON.parse(h.snapshot),
  }));
  res.json(history);
});

app.get('/api/cash-articles', requireAnyPermission('cashier.view', 'cashier.edit', 'payments.view', 'payments.edit'), (req, res) => {
  res.json(svc.getCashArticles(req.query.direction || null));
});

app.get('/api/cash-articles/all', requirePermission('cash_articles.view'), (_, res) => {
  res.json(svc.getCashArticlesAll());
});

app.post('/api/cash-articles', requirePermission('cash_articles.edit'), (req, res) => {
  try {
    res.status(201).json(svc.createCashArticle(req.body));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/cash-articles/:id', requirePermission('cash_articles.edit'), (req, res) => {
  try {
    res.json(svc.updateCashArticle(req.params.id, req.body));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/cash-articles/:id', requirePermission('cash_articles.edit'), (req, res) => {
  try {
    res.json(svc.deleteCashArticle(req.params.id));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Payments
app.get('/api/payments', requireAnyPermission(
  'cashier.view', 'cashier.edit', 'cashier.delete',
  'payments.view', 'payments.edit',
), attachBranch, (req, res) => {
  res.json(svc.getPayments(req.branchId));
});

app.post('/api/payments', requireAnyPermission('cashier.edit', 'payments.edit'), attachBranch, (req, res) => {
  try {
    res.status(201).json(svc.createPayment(req.body, req.user.id, req.branchId, req.user.role));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/payments/:id', requireAnyPermission('cashier.edit', 'payments.edit'), attachBranch, (req, res) => {
  try {
    res.json(svc.updatePayment(req.params.id, req.body, req.branchId, req.user.role));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/payments/:id', requireAnyPermission('cashier.delete', 'payments.delete'), attachBranch, (req, res) => {
  try {
    svc.deletePayment(req.params.id, req.user.role, req.branchId);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Telegram
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

app.get('/api/telegram/messages', requirePermission('telegram.view'), (_, res) => {
  res.json(svc.getTelegramMessages());
});

app.post('/api/telegram/send', requirePermission('telegram.view'), async (req, res) => {
  const { counterparty_id, message, document_id } = req.body;
  const cp = db.queryOne('SELECT * FROM counterparties WHERE id = ?', [counterparty_id]);
  if (!cp) return res.status(404).json({ error: 'Контрагент не найден' });

  const result = await sendCustomMessage(cp, message, document_id || null);
  if (result.success) {
    res.json({ ok: true });
  } else {
    res.status(400).json({ error: result.error });
  }
});

app.post('/api/telegram/send-document/:id', requirePermission('telegram.view'), async (req, res) => {
  const doc = svc.getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Документ не найден' });
  if (!doc.counterparty_id) return res.status(400).json({ error: 'У документа нет контрагента' });

  const cp = db.queryOne('SELECT * FROM counterparties WHERE id = ?', [doc.counterparty_id]);
  const result = await sendDocumentNotification(doc, cp);
  if (result.success) {
    res.json({ ok: true });
  } else {
    res.status(400).json({ error: result.error });
  }
});

const clientDist = join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(join(clientDist, 'index.html'), (err) => {
    if (err) res.status(404).send('Frontend not built. Run: npm run build');
  });
});

async function start() {
  await db.initDb();
  departments.migrateDepartmentStockSync();
  initPermissions(db);
  seedDefaultUsers();

  if (process.env.TELEGRAM_ENABLED !== 'false') {
    const dbToken = svc.getSetting('telegram_bot_token');
    const token = dbToken || process.env.TELEGRAM_BOT_TOKEN;
    if (token) {
      try {
        await initTelegram(token);
      } catch (err) {
        console.error('⚠️  Telegram бот не запущен:', err.message);
      }
    }
  }

  app.listen(PORT, () => {
    console.log(`🚀 Сервер: http://localhost:${PORT}`);
    console.log(`📁 База данных: ${dbPath}`);
    if (process.env.NODE_ENV !== 'production') {
      console.log('👤 Логины: admin/admin123, sklad/sklad123, kassir/kassir123');
    }
  });
}

start().catch((err) => {
  console.error('Ошибка запуска:', err);
  process.exit(1);
});
