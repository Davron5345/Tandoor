import { v4 as uuidv4 } from 'uuid';
import db from './db.js';
import { adjustBranchStock, getBranchStock, DEFAULT_BRANCH_ID } from './branches.js';
import {
  adjustDepartmentStock,
  assertDepartmentInBranch,
  getDefaultDepartmentId,
  getDepartmentStock,
  syncBranchStockFromDepartments,
} from './departments.js';
import {
  deleteVariantDepartmentStock,
  getDepartmentAvgCost,
  getVariantBranchStock,
  issueDepartmentStock,
  receiveDepartmentStock,
  reverseIssueDepartmentStock,
  reverseReceiveDepartmentStock,
  reverseTransferDepartmentStock,
  setDepartmentStock,
  syncVariantCatalogStock,
  transferDepartmentStock,
} from './inventoryCost.js';
import { deleteAllProductImages, deleteVariantImages } from './productImages.js';
import { getCalculation, calcLineKey } from './calculations.js';
import { hasPermission } from './permissions.js';

const { queryAll, queryOne, run, transaction } = db;

export const DEFAULT_CONTRACT_ID = '__default__';

function generateDocNumber(branchId = DEFAULT_BRANCH_ID, docType) {
  if (!docType) throw new Error('Тип документа обязателен для номера');
  const rows = queryAll(`
    SELECT number FROM documents
    WHERE type = ?
      AND COALESCE(NULLIF(branch_id, ''), NULLIF(from_branch_id, ''), ?) = ?
  `, [docType, branchId, branchId]);
  let max = 0;
  for (const row of rows) {
    const n = parseInt(String(row.number).replace(/\D/g, ''), 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return String(max + 1);
}

export function getNextDocNumber(branchId = DEFAULT_BRANCH_ID, docType) {
  return generateDocNumber(branchId, docType);
}

function resolveDocumentContractId(contractId, counterpartyId, branchId = DEFAULT_BRANCH_ID) {
  if (!contractId || contractId === DEFAULT_CONTRACT_ID) return null;
  if (!counterpartyId) throw new Error('Выберите контрагента для договора');
  const contract = queryOne(
    'SELECT id FROM counterparty_contracts WHERE id = ? AND counterparty_id = ? AND branch_id = ?',
    [contractId, counterpartyId, branchId],
  );
  if (!contract) throw new Error('Договор не найден');
  return contract.id;
}

function isOutgoingDocType(type) {
  return type === 'rashod' || type === 'return_supplier';
}

function isSupplierCounterpartyDoc(type) {
  return type === 'prihod' || type === 'return_supplier';
}

function normalizeIsoDate(value) {
  const date = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function assertReturnSupplierSourceDocument(sourceDocumentId, branchId, supplierId, returnDate = null) {
  if (!sourceDocumentId) throw new Error('Выберите приходный документ для возврата');
  const doc = queryOne(
    'SELECT id, type, status, branch_id, counterparty_id FROM documents WHERE id = ?',
    [sourceDocumentId],
  );
  if (!doc) throw new Error('Приходный документ не найден');
  if (doc.type !== 'prihod') throw new Error('Для возврата можно выбрать только приходный документ');
  if (doc.status !== 'confirmed') throw new Error('Возврат привязывается только к проведённому приходу');
  if ((doc.branch_id || DEFAULT_BRANCH_ID) !== (branchId || DEFAULT_BRANCH_ID)) {
    throw new Error('Приходный документ относится к другому филиалу');
  }
  if (!doc.counterparty_id || doc.counterparty_id !== supplierId) {
    throw new Error('Приходный документ не относится к выбранному поставщику');
  }
  const sourceDate = normalizeIsoDate(doc.date);
  const targetDate = normalizeIsoDate(returnDate);
  if (sourceDate && targetDate && targetDate < sourceDate) {
    throw new Error('Дата возврата не может быть раньше даты приходного документа');
  }
  return doc;
}

function snapshotDocument(docId) {
  const doc = queryOne('SELECT * FROM documents WHERE id = ?', [docId]);
  const items = queryAll(`
    SELECT di.*, p.name as product_name, p.sku, p.unit
    FROM document_items di
    JOIN products p ON p.id = di.product_id
    WHERE di.document_id = ?
  `, [docId]);
  const counterparty = doc?.counterparty_id
    ? queryOne('SELECT * FROM counterparties WHERE id = ?', [doc.counterparty_id])
    : null;
  return JSON.stringify({ document: doc, items, counterparty });
}

function addHistory(documentId, action, userId = null) {
  run(`
    INSERT INTO document_history (id, document_id, action, snapshot, changed_by)
    VALUES (?, ?, ?, ?, ?)
  `, [uuidv4(), documentId, action, snapshotDocument(documentId), userId]);
}

function afterVariantStockChange(variantId, productId, branchId) {
  if (!variantId) return;
  syncVariantCatalogStock(variantId, branchId);
  syncBranchStockFromDepartments(branchId, productId);
}

function updateStock(documentId, reverse = false) {
  const doc = queryOne('SELECT * FROM documents WHERE id = ?', [documentId]);
  if (!doc || doc.status !== 'confirmed') return;

  const items = queryAll('SELECT * FROM document_items WHERE document_id = ?', [documentId]);
  const multiplier = reverse ? -1 : 1;
  const variantId = (item) => item.variant_id || null;

  if (doc.type === 'razdelka') {
    const branchId = doc.branch_id || DEFAULT_BRANCH_ID;
    const fromDept = doc.from_department_id;
    const toDept = doc.to_department_id;
    const inputItems = items.filter((i) => (i.item_role || 'input') === 'input');
    const outputItems = items.filter((i) => i.item_role === 'output');

    for (const item of inputItems) {
      if (!reverse) {
        issueDepartmentStock(fromDept, item.product_id, item.quantity, variantId(item));
      } else {
        reverseIssueDepartmentStock(fromDept, item.product_id, item.quantity, item.price || 0, variantId(item));
      }
      afterVariantStockChange(variantId(item), item.product_id, branchId);
      syncBranchStockFromDepartments(branchId, item.product_id);
    }
    for (const item of outputItems) {
      const unitCost = item.price || 0;
      if (!reverse) {
        receiveDepartmentStock(toDept, item.product_id, item.quantity, unitCost, variantId(item));
      } else {
        reverseReceiveDepartmentStock(toDept, item.product_id, item.quantity, unitCost, variantId(item));
      }
      afterVariantStockChange(variantId(item), item.product_id, branchId);
      syncBranchStockFromDepartments(branchId, item.product_id);
    }
    return;
  }

  if (doc.type === 'peremeshchenie') {
    const fromId = doc.from_branch_id || doc.branch_id;
    const toId = doc.to_branch_id || fromId;
    const fromDept = doc.from_department_id || null;
    const toDept = doc.to_department_id || null;

    if (fromDept || toDept) {
      const branchId = fromId || DEFAULT_BRANCH_ID;
      for (const item of items) {
        const qty = Math.abs(item.quantity);
        if (qty <= 0) continue;

        let sourceDept = fromDept;
        let targetDept = toDept;
        if (fromDept && toDept) {
          // direct transfer
        } else if (!fromDept && toDept) {
          sourceDept = getDefaultDepartmentId(branchId);
          if (!sourceDept) throw new Error('Не найден отдел-источник для перемещения');
        } else if (fromDept && !toDept) {
          targetDept = getDefaultDepartmentId(branchId);
          if (!targetDept) throw new Error('Не найден отдел-получатель для перемещения');
        }

        const vid = variantId(item);
        if (multiplier > 0) {
          transferDepartmentStock(sourceDept, targetDept, item.product_id, qty, vid);
        } else {
          const unitCost = getDepartmentAvgCost(targetDept, item.product_id, vid);
          reverseTransferDepartmentStock(sourceDept, targetDept, item.product_id, qty, unitCost, vid);
        }
        afterVariantStockChange(vid, item.product_id, branchId);
        syncBranchStockFromDepartments(branchId, item.product_id);
      }
      return;
    }

    if (!fromId || !toId) return;
    if (fromId === toId) throw new Error('Филиалы отправления и получения должны отличаться');
    for (const item of items) {
      adjustBranchStock(fromId, item.product_id, -item.quantity * multiplier);
      adjustBranchStock(toId, item.product_id, item.quantity * multiplier);
    }
    return;
  }

  const branchId = doc.branch_id || DEFAULT_BRANCH_ID;
  for (const item of items) {
    const qty = Math.abs(item.quantity);
    if (qty <= 0) continue;
    const vid = variantId(item);

    if (doc.type === 'prihod' && doc.to_department_id) {
      if (multiplier > 0) {
        receiveDepartmentStock(doc.to_department_id, item.product_id, qty, item.price || 0, vid);
      } else {
        reverseReceiveDepartmentStock(doc.to_department_id, item.product_id, qty, item.price || 0, vid);
      }
      afterVariantStockChange(vid, item.product_id, branchId);
      syncBranchStockFromDepartments(branchId, item.product_id);
    } else if (isOutgoingDocType(doc.type) && doc.from_department_id) {
      if (multiplier > 0) {
        issueDepartmentStock(doc.from_department_id, item.product_id, qty, vid);
      } else {
        reverseIssueDepartmentStock(doc.from_department_id, item.product_id, qty, item.price || 0, vid);
      }
      afterVariantStockChange(vid, item.product_id, branchId);
      syncBranchStockFromDepartments(branchId, item.product_id);
    }
  }
}

function getItemStockLabel(item) {
  if (item.variant_id) {
    const row = queryOne(`
      SELECT pv.name as variant_name, p.name as product_name
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      WHERE pv.id = ?
    `, [item.variant_id]);
    if (row) return `${row.product_name} — ${row.variant_name}`;
  }
  const product = queryOne('SELECT name FROM products WHERE id = ?', [item.product_id]);
  return product?.name || 'товар';
}

function validateRashodStock(branchId, fromDepartmentId, items, reverse = false) {
  if (reverse) return;
  if (!fromDepartmentId) throw new Error('Выберите отдел для расхода/возврата');
  assertDepartmentInBranch(fromDepartmentId, branchId);
  for (const item of items) {
    const stock = getDepartmentStock(item.product_id, fromDepartmentId, item.variant_id || null);
    if (stock < item.quantity) {
      const label = getItemStockLabel(item);
      throw new Error(`Недостаточно остатка «${label}» (есть ${stock})`);
    }
  }
}

function validateDepartmentTransfer(branchId, fromDept, toDept, items, reverse = false) {
  if (reverse) return;
  for (const item of items) {
    const label = getItemStockLabel(item);
    if (fromDept && toDept) {
      const stock = getDepartmentStock(item.product_id, fromDept, item.variant_id || null);
      if (stock < item.quantity) {
        throw new Error(`Недостаточно остатка «${label}» в отделе-отправителе (есть ${stock})`);
      }
    } else if (!fromDept && toDept) {
      const sourceDept = getDefaultDepartmentId(branchId);
      if (!sourceDept) throw new Error('Не найден отдел-источник');
      const stock = getDepartmentStock(item.product_id, sourceDept, item.variant_id || null);
      if (stock < item.quantity) {
        throw new Error(`Недостаточно остатка «${label}» в отделе-источнике (есть ${stock})`);
      }
    } else if (fromDept && !toDept) {
      const stock = getDepartmentStock(item.product_id, fromDept, item.variant_id || null);
      if (stock < item.quantity) {
        throw new Error(`Недостаточно остатка «${label}» в отделе (есть ${stock})`);
      }
    }
  }
}

function validatePeremeshchenie(fromBranchId, toBranchId, fromDept, toDept, items, reverse = false) {
  if (fromDept || toDept) {
    if (fromBranchId !== toBranchId) {
      throw new Error('Для перемещения между отделами выберите один филиал');
    }
    if (fromDept && toDept && fromDept === toDept) {
      throw new Error('Отделы отправления и получения должны отличаться');
    }
    validateDepartmentTransfer(fromBranchId, fromDept, toDept, items, reverse);
    return;
  }
  if (!toBranchId) throw new Error('Укажите филиал получателя');
  if (fromBranchId === toBranchId) throw new Error('Филиалы отправления и получения должны отличаться');
  validateTransferStock(fromBranchId, items, reverse);
}

function validateTransferStock(fromBranchId, items, reverse = false) {
  if (reverse) {
    for (const item of items) {
      const stock = item.variant_id
        ? getVariantBranchStock(item.variant_id, fromBranchId)
        : getBranchStock(item.product_id, fromBranchId);
      if (stock < item.quantity) {
        throw new Error(`Недостаточно остатка «${getItemStockLabel(item)}» для отмены перемещения`);
      }
    }
    return;
  }
  for (const item of items) {
    const stock = item.variant_id
      ? getVariantBranchStock(item.variant_id, fromBranchId)
      : getBranchStock(item.product_id, fromBranchId);
    if (stock < item.quantity) {
      const label = getItemStockLabel(item);
      throw new Error(`Недостаточно остатка «${label}» на филиале-отправителе (есть ${stock})`);
    }
  }
}

function getLastPricesMap(branchId, docType, counterpartyId = null) {
  const buildMap = (cpId) => {
    let sql = `
      SELECT di.product_id, di.variant_id, di.price
      FROM document_items di
      JOIN documents d ON d.id = di.document_id
      WHERE d.status = 'confirmed'
        AND d.type = ?
        AND COALESCE(d.branch_id, d.from_branch_id, ?) = ?
    `;
    const params = [docType, branchId, branchId];
    if (cpId) {
      sql += ' AND d.counterparty_id = ?';
      params.push(cpId);
    }
    sql += ' ORDER BY d.date DESC, d.created_at DESC';

    const rows = queryAll(sql, params);
    const map = {};
    for (const row of rows) {
      const key = row.variant_id ? `v:${row.variant_id}` : row.product_id;
      if (map[key] === undefined) {
        map[key] = row.price;
      }
    }
    return map;
  };

  const map = buildMap(counterpartyId || null);
  if (counterpartyId && docType === 'prihod') {
    const fallback = buildMap(null);
    for (const [key, price] of Object.entries(fallback)) {
      if (map[key] === undefined) map[key] = price;
    }
  }
  return map;
}

function lastPriceForItem(lastMap, productId, variantId = null) {
  if (!lastMap) return null;
  if (variantId) {
    return lastMap[`v:${variantId}`] ?? lastMap[productId] ?? null;
  }
  return lastMap[productId] ?? null;
}

export function getProductLastPrice(productId, branchId, docType, counterpartyId = null) {
  const map = getLastPricesMap(branchId, docType, counterpartyId);
  return map[productId] ?? null;
}

export function getProducts(filters = {}) {
  const branchId = filters.branch_id || DEFAULT_BRANCH_ID;
  const departmentId = filters.department_id || null;

  let stockSelect;
  let stockJoin;
  let params;

  if (departmentId) {
    stockSelect = `COALESCE((
      SELECT SUM(pds_all.stock)
      FROM product_department_stock pds_all
      WHERE pds_all.department_id = ? AND pds_all.product_id = p.id
        AND (
          COALESCE(p.has_variants, 0) = 0 AND (pds_all.variant_id IS NULL OR pds_all.variant_id = '')
          OR COALESCE(p.has_variants, 0) = 1 AND pds_all.variant_id IS NOT NULL AND pds_all.variant_id != ''
        )
    ), 0) as stock,
    COALESCE((
      SELECT SUM(pds_all.stock * pds_all.avg_cost) / NULLIF(SUM(pds_all.stock), 0)
      FROM product_department_stock pds_all
      WHERE pds_all.department_id = ? AND pds_all.product_id = p.id
        AND (
          COALESCE(p.has_variants, 0) = 0 AND (pds_all.variant_id IS NULL OR pds_all.variant_id = '')
          OR COALESCE(p.has_variants, 0) = 1 AND pds_all.variant_id IS NOT NULL AND pds_all.variant_id != ''
        )
    ), p.price) as avg_cost`;
    stockJoin = '';
    params = [departmentId, departmentId];
  } else {
    stockSelect = `COALESCE((
      SELECT SUM(pds2.stock)
      FROM product_department_stock pds2
      JOIN departments dep ON dep.id = pds2.department_id AND dep.branch_id = ?
      WHERE pds2.product_id = p.id
        AND (
          COALESCE(p.has_variants, 0) = 0 AND (pds2.variant_id IS NULL OR pds2.variant_id = '')
          OR COALESCE(p.has_variants, 0) = 1 AND pds2.variant_id IS NOT NULL AND pds2.variant_id != ''
        )
    ), COALESCE(pbs.stock, 0)) as stock,
    COALESCE((
      SELECT SUM(pds3.stock * pds3.avg_cost) / NULLIF(SUM(pds3.stock), 0)
      FROM product_department_stock pds3
      JOIN departments dep3 ON dep3.id = pds3.department_id AND dep3.branch_id = ?
      WHERE pds3.product_id = p.id
        AND (
          COALESCE(p.has_variants, 0) = 0 AND (pds3.variant_id IS NULL OR pds3.variant_id = '')
          OR COALESCE(p.has_variants, 0) = 1 AND pds3.variant_id IS NOT NULL AND pds3.variant_id != ''
        )
    ), p.price) as avg_cost`;
    stockJoin = 'LEFT JOIN product_branch_stock pbs ON pbs.product_id = p.id AND pbs.branch_id = ?';
    params = [branchId, branchId, branchId];
  }

  let products = queryAll(`
    SELECT p.*, ${stockSelect},
           pc.name as category_name, pc.parent_id as category_parent_id,
           ppc.name as parent_category_name,
           COALESCE(ppc.sort_order, pc.sort_order, 999) as category_sort,
           COALESCE(pc.sort_order, 999) as subcategory_sort,
           pi.file_name as primary_file_name,
           pi.media_type as primary_media_type,
           (SELECT COUNT(*) FROM product_images WHERE product_id = p.id AND media_type = 'photo') as photo_count,
           (SELECT COUNT(*) FROM product_images WHERE product_id = p.id AND media_type = 'gif') as gif_count
    FROM products p
    ${stockJoin}
    LEFT JOIN product_categories pc ON pc.id = p.category_id
    LEFT JOIN product_categories ppc ON ppc.id = pc.parent_id
    LEFT JOIN product_images pi ON pi.id = (
      SELECT id FROM product_images
      WHERE product_id = p.id
        AND (
          (COALESCE(p.has_variants, 0) = 0 AND (variant_id IS NULL OR variant_id = ''))
          OR (COALESCE(p.has_variants, 0) = 1 AND variant_id IS NOT NULL)
        )
      ORDER BY is_primary DESC, sort_order, created_at
      LIMIT 1
    )
    ORDER BY COALESCE(ppc.sort_order, pc.sort_order, 999), ppc.name, pc.parent_id IS NOT NULL, pc.sort_order, pc.name, p.name
  `, params);

  const lastMap = filters.last_doc_type
    ? getLastPricesMap(
      branchId,
      filters.last_doc_type,
      filters.counterparty_id || filters.supplier_id || null,
    )
    : null;

  products = products.map((p) => ({
    ...p,
    last_price: lastMap ? lastPriceForItem(lastMap, p.id) : null,
  }));

  if (filters.category_id) {
    products = products.filter((p) => p.category_id === filters.category_id);
  }

  let result = products.map((p) => enrichProduct(p, branchId, departmentId, lastMap));

  if (filters.supplier_id) {
    result = result.filter((p) =>
      p.suppliers.some((s) => s.id === filters.supplier_id)
    );
  }

  return result;
}

export function getProductCategories() {
  return queryAll(`
    SELECT pc.*,
           parent.name as parent_name,
           COUNT(DISTINCT p.id) as product_count,
           (SELECT COUNT(*) FROM product_categories ch WHERE ch.parent_id = pc.id) as subcategory_count
    FROM product_categories pc
    LEFT JOIN products p ON p.category_id = pc.id
    LEFT JOIN product_categories parent ON parent.id = pc.parent_id
    GROUP BY pc.id
    ORDER BY COALESCE(parent.sort_order, pc.sort_order), parent.name, pc.parent_id IS NOT NULL, pc.sort_order, pc.name
  `);
}

function assertValidParent(categoryId, parentId) {
  if (!parentId) return null;
  if (categoryId && parentId === categoryId) {
    throw new Error('Категория не может быть родителем самой себя');
  }

  const parent = queryOne('SELECT id, parent_id FROM product_categories WHERE id = ?', [parentId]);
  if (!parent) throw new Error('Родительская категория не найдена');
  if (parent.parent_id) throw new Error('Подкатегорию можно создать только в категории верхнего уровня');

  if (categoryId) {
    let current = parentId;
    while (current) {
      if (current === categoryId) throw new Error('Нельзя выбрать потомка как родительскую категорию');
      current = queryOne('SELECT parent_id FROM product_categories WHERE id = ?', [current])?.parent_id || null;
    }
  }

  return parentId;
}

function assertUniqueCategoryName(name, parentId, excludeId = null) {
  const row = excludeId
    ? queryOne(
      `SELECT id FROM product_categories
       WHERE name = ? COLLATE NOCASE
         AND COALESCE(parent_id, '') = COALESCE(?, '')
         AND id != ?`,
      [name, parentId || null, excludeId],
    )
    : queryOne(
      `SELECT id FROM product_categories
       WHERE name = ? COLLATE NOCASE
         AND COALESCE(parent_id, '') = COALESCE(?, '')`,
      [name, parentId || null],
    );
  if (row) throw new Error('Категория с таким названием уже есть на этом уровне');
}

export function createProductCategory(data) {
  const name = (data.name || '').trim();
  if (!name) throw new Error('Укажите название категории');

  const parentId = assertValidParent(null, data.parent_id || null);
  assertUniqueCategoryName(name, parentId);

  const id = uuidv4();
  const sortOrder = data.sort_order ?? queryOne('SELECT COALESCE(MAX(sort_order), 0) + 1 as n FROM product_categories').n;
  run(
    'INSERT INTO product_categories (id, name, parent_id, sort_order) VALUES (?, ?, ?, ?)',
    [id, name, parentId, sortOrder],
  );
  return queryOne('SELECT * FROM product_categories WHERE id = ?', [id]);
}

export function updateProductCategory(id, data) {
  const cat = queryOne('SELECT * FROM product_categories WHERE id = ?', [id]);
  if (!cat) throw new Error('Категория не найдена');

  const name = (data.name || cat.name).trim();
  if (!name) throw new Error('Укажите название категории');

  const parentId = data.parent_id !== undefined
    ? assertValidParent(id, data.parent_id || null)
    : cat.parent_id;

  if (id === 'other' && parentId) throw new Error('Категорию «Прочее» нельзя сделать подкатегорией');

  const hasChildren = queryOne('SELECT COUNT(*) as c FROM product_categories WHERE parent_id = ?', [id]).c;
  if (hasChildren && parentId) {
    throw new Error('Категория с подкатегориями не может быть подкатегорией');
  }

  assertUniqueCategoryName(name, parentId, id);

  run(
    'UPDATE product_categories SET name = ?, parent_id = ?, sort_order = ? WHERE id = ?',
    [name, parentId, data.sort_order ?? cat.sort_order, id],
  );
  return queryOne('SELECT * FROM product_categories WHERE id = ?', [id]);
}

export function deleteProductCategory(id) {
  if (id === 'other') throw new Error('Нельзя удалить системную категорию «Прочее»');

  const cat = queryOne('SELECT id, parent_id FROM product_categories WHERE id = ?', [id]);
  if (!cat) throw new Error('Категория не найдена');

  const subcategories = queryAll('SELECT id FROM product_categories WHERE parent_id = ?', [id]);
  for (const sub of subcategories) {
    run('UPDATE product_categories SET parent_id = ? WHERE id = ?', [cat.parent_id, sub.id]);
  }

  const count = queryOne('SELECT COUNT(*) as c FROM products WHERE category_id = ?', [id]).c;
  if (count > 0) {
    run("UPDATE products SET category_id = 'other' WHERE category_id = ?", [id]);
  }
  run('DELETE FROM product_categories WHERE id = ?', [id]);
}

function assertUniqueBarcode(barcode, excludeId = null) {
  const code = (barcode || '').trim();
  if (!code) return '';
  const row = excludeId
    ? queryOne('SELECT id FROM products WHERE barcode = ? AND id != ?', [code, excludeId])
    : queryOne('SELECT id FROM products WHERE barcode = ?', [code]);
  if (row) throw new Error('Штрих-код уже используется другим товаром');
  return code;
}

function normalizeProductPayload(data) {
  const name = (data.name || '').trim();
  if (!name) throw new Error('Укажите наименование товара');

  const categoryId = data.category_id || 'other';
  const category = queryOne('SELECT id FROM product_categories WHERE id = ?', [categoryId]);
  if (!category) throw new Error('Категория не найдена');

  const unit = (data.unit || '').trim();
  if (!unit) throw new Error('Укажите единицу измерения');

  const netWeight = data.net_weight === '' || data.net_weight == null ? null : Number(data.net_weight);
  const grossWeight = data.gross_weight === '' || data.gross_weight == null ? null : Number(data.gross_weight);
  if (netWeight != null && Number.isNaN(netWeight)) throw new Error('Некорректное значение нетто');
  if (grossWeight != null && Number.isNaN(grossWeight)) throw new Error('Некорректное значение брутто');
  if (netWeight != null && grossWeight != null && netWeight > grossWeight) {
    throw new Error('Нетто не может быть больше брутто');
  }

  if (data.price === '' || data.price == null || Number.isNaN(Number(data.price))) {
    if (!data.has_variants) throw new Error('Укажите цену');
  }

  const hasVariants = !!data.has_variants;
  let price = 0;

  if (hasVariants) {
    const variants = normalizeVariantsInput(data.variants || []);
    if (variants.length === 0) throw new Error('Добавьте хотя бы один вариант');
    price = Math.min(...variants.map((v) => v.price));
  } else {
    if (data.price === '' || data.price == null || Number.isNaN(Number(data.price))) {
      throw new Error('Укажите цену');
    }
    price = Number(data.price);
    if (price < 0) throw new Error('Цена не может быть отрицательной');
  }

  return {
    name,
    sku: (data.sku || '').trim(),
    unit,
    price,
    has_variants: hasVariants ? 1 : 0,
    category_id: categoryId,
    barcode: (data.barcode || '').trim(),
    net_weight: netWeight,
    gross_weight: grossWeight,
  };
}

function normalizeVariantsInput(variants) {
  if (!Array.isArray(variants)) return [];
  return variants.map((v, idx) => {
    const name = (v.name || '').trim();
    if (!name) throw new Error('Укажите название варианта');
    if (v.price === '' || v.price == null || Number.isNaN(Number(v.price))) {
      throw new Error(`Укажите цену варианта «${name}»`);
    }
    const price = Number(v.price);
    if (price < 0) throw new Error(`Цена варианта «${name}» не может быть отрицательной`);
    const stock = v.stock === '' || v.stock == null ? 0 : Number(v.stock);
    if (Number.isNaN(stock) || stock < 0) {
      throw new Error(`Некорректный остаток варианта «${name}»`);
    }
    return {
      id: v.id || null,
      name,
      price,
      stock,
      sort_order: idx,
    };
  });
}

function syncProductStockFromVariants(productId, branchId = DEFAULT_BRANCH_ID) {
  const variants = queryAll('SELECT id FROM product_variants WHERE product_id = ?', [productId]);
  let total = 0;
  for (const variant of variants) {
    total += getVariantBranchStock(variant.id, branchId);
    syncVariantCatalogStock(variant.id, branchId);
  }
  const current = getBranchStock(branchId, productId);
  adjustBranchStock(branchId, productId, total - current);
}

function adjustVariantStock(variantId, delta) {
  run('UPDATE product_variants SET stock = COALESCE(stock, 0) + ? WHERE id = ?', [delta, variantId]);
  const row = queryOne('SELECT product_id FROM product_variants WHERE id = ?', [variantId]);
  if (row) syncProductStockFromVariants(row.product_id);
}

function getVariantStock(variantId, productId = null, departmentId = null, branchId = DEFAULT_BRANCH_ID) {
  if (departmentId && productId) {
    return getDepartmentStock(productId, departmentId, variantId);
  }
  return getVariantBranchStock(variantId, branchId);
}

function getProductVariants(productId, departmentId = null, branchId = DEFAULT_BRANCH_ID, lastMap = null) {
  const variants = queryAll(`
    SELECT id, product_id, name, price, stock, sort_order
    FROM product_variants
    WHERE product_id = ?
    ORDER BY sort_order, name
  `, [productId]);

  return variants.map((variant) => {
    let stock = variant.stock || 0;
    let avg_cost = variant.price || 0;

    if (departmentId) {
      const row = queryOne(
        'SELECT stock, avg_cost FROM product_department_stock WHERE department_id = ? AND product_id = ? AND variant_id = ?',
        [departmentId, productId, variant.id],
      );
      stock = row?.stock ?? 0;
      avg_cost = row?.avg_cost ?? variant.price ?? 0;
    } else {
      stock = getVariantBranchStock(variant.id, branchId);
      const avgRow = queryOne(`
        SELECT SUM(pds.stock * pds.avg_cost) / NULLIF(SUM(pds.stock), 0) as avg_cost
        FROM product_department_stock pds
        JOIN departments d ON d.id = pds.department_id AND d.branch_id = ?
        WHERE pds.variant_id = ?
      `, [branchId, variant.id]);
      avg_cost = avgRow?.avg_cost ?? variant.price ?? 0;
    }

    return {
      ...variant,
      stock,
      avg_cost,
      last_price: lastMap ? lastPriceForItem(lastMap, productId, variant.id) : null,
      images: queryAll(`
        SELECT id, product_id, variant_id, file_name, original_name, mime_type, media_type, size, sort_order, is_primary, created_at
        FROM product_images
        WHERE variant_id = ?
        ORDER BY media_type, sort_order, created_at
      `, [variant.id]).map((row) => ({
        ...row,
        is_primary: !!row.is_primary,
        url: `/uploads/products/${row.product_id}/${row.file_name}`,
      })),
    };
  });
}

function saveProductVariants(productId, hasVariants, variantsInput, branchId = DEFAULT_BRANCH_ID) {
  if (!hasVariants) {
    const oldVariants = queryAll('SELECT id FROM product_variants WHERE product_id = ?', [productId]);
    for (const variant of oldVariants) {
      deleteVariantImages(variant.id);
      deleteVariantDepartmentStock(variant.id);
    }
    run('DELETE FROM product_variants WHERE product_id = ?', [productId]);
    run('UPDATE products SET has_variants = 0 WHERE id = ?', [productId]);
    return [];
  }

  const variants = normalizeVariantsInput(variantsInput);
  const existingIds = queryAll('SELECT id FROM product_variants WHERE product_id = ?', [productId]).map((r) => r.id);
  const keptIds = [];
  const defaultDeptId = getDefaultDepartmentId(branchId);

  for (const variant of variants) {
    if (variant.id && existingIds.includes(variant.id)) {
      run(
        'UPDATE product_variants SET name = ?, price = ?, stock = ?, sort_order = ? WHERE id = ?',
        [variant.name, variant.price, variant.stock, variant.sort_order, variant.id],
      );
      keptIds.push(variant.id);
    } else {
      const id = uuidv4();
      run(
        'INSERT INTO product_variants (id, product_id, name, price, stock, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
        [id, productId, variant.name, variant.price, variant.stock, variant.sort_order],
      );
      variant.id = id;
      keptIds.push(id);
    }

    if (defaultDeptId) {
      setDepartmentStock(defaultDeptId, productId, variant.stock, variant.price, variant.id);
      syncVariantCatalogStock(variant.id, branchId);
    }
  }

  for (const oldId of existingIds) {
    if (!keptIds.includes(oldId)) {
      deleteVariantImages(oldId);
      deleteVariantDepartmentStock(oldId);
      run('DELETE FROM product_variants WHERE id = ?', [oldId]);
    }
  }

  const minPrice = Math.min(...variants.map((v) => v.price));
  run('UPDATE products SET has_variants = 1, price = ? WHERE id = ?', [minPrice, productId]);
  syncProductStockFromVariants(productId, branchId);
  return getProductVariants(productId, null, branchId);
}

function getSuppliersForProduct(productId, branchId = DEFAULT_BRANCH_ID) {
  return queryAll(`
    SELECT c.id, c.name, c.phone, c.telegram_chat_id
    FROM product_suppliers ps
    JOIN counterparties c ON c.id = ps.supplier_id AND c.branch_id = ?
    WHERE ps.product_id = ? AND ps.branch_id = ?
    ORDER BY c.name
  `, [branchId, productId, branchId]);
}

function enrichProduct(product, branchId = DEFAULT_BRANCH_ID, departmentId = null, lastMap = null) {
  const {
    primary_file_name,
    primary_media_type,
    photo_count,
    gif_count,
    ...rest
  } = product;

  const extraCount = Math.max(0, (photo_count || 0) + (gif_count || 0) - (primary_file_name ? 1 : 0));
  const hasVariants = !!rest.has_variants;
  const variants = hasVariants ? getProductVariants(product.id, departmentId, branchId, lastMap) : [];
  const variantPrices = variants.map((v) => v.price);
  const variantStocks = variants.map((v) => v.stock || 0);

  if (hasVariants && variants.length) {
    rest.stock = variantStocks.reduce((s, v) => s + v, 0);
    if (departmentId || branchId) {
      rest.avg_cost = variants.reduce((s, v) => s + (v.stock || 0) * (v.avg_cost || 0), 0)
        / (rest.stock || 1);
    }
  }

  return {
    ...rest,
    has_variants: hasVariants,
    variants,
    variant_price_min: variantPrices.length ? Math.min(...variantPrices) : null,
    variant_price_max: variantPrices.length ? Math.max(...variantPrices) : null,
    suppliers: getSuppliersForProduct(product.id, branchId),
    primary_image: primary_file_name
      ? {
        url: `/uploads/products/${product.id}/${primary_file_name}`,
        media_type: primary_media_type,
      }
      : null,
    photo_count: photo_count || 0,
    gif_count: gif_count || 0,
    image_count: (photo_count || 0) + (gif_count || 0),
    extra_image_count: extraCount,
  };
}

function setProductSuppliers(productId, supplierIds = [], branchId = DEFAULT_BRANCH_ID) {
  run('DELETE FROM product_suppliers WHERE product_id = ? AND branch_id = ?', [productId, branchId]);
  const unique = [...new Set((supplierIds || []).filter(Boolean))];

  for (const supplierId of unique) {
    const supplier = queryOne(
      'SELECT id FROM counterparties WHERE id = ? AND type = ? AND branch_id = ?',
      [supplierId, 'supplier', branchId],
    );
    if (!supplier) continue;
    run(
      'INSERT INTO product_suppliers (id, product_id, supplier_id, branch_id) VALUES (?, ?, ?, ?)',
      [uuidv4(), productId, supplierId, branchId],
    );
  }
}

export function createProduct(data) {
  const payload = normalizeProductPayload(data);
  payload.barcode = assertUniqueBarcode(payload.barcode);

  const id = uuidv4();
  run(`
    INSERT INTO products (id, name, sku, unit, price, stock, category_id, barcode, net_weight, gross_weight, has_variants)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
  `, [
    id, payload.name, payload.sku, payload.unit, payload.price,
    payload.category_id, payload.barcode || null,
    payload.net_weight, payload.gross_weight,
    payload.has_variants,
  ]);

  const branchId = data.branch_id || DEFAULT_BRANCH_ID;
  if (data.stock && data.stock > 0) {
    const defaultDeptId = getDefaultDepartmentId(branchId);
    if (defaultDeptId) {
      receiveDepartmentStock(defaultDeptId, id, data.stock, payload.price || 0);
      syncBranchStockFromDepartments(branchId, id);
    } else {
      adjustBranchStock(branchId, id, data.stock);
    }
  }

  setProductSuppliers(id, data.supplier_ids, branchId);
  saveProductVariants(id, !!payload.has_variants, data.variants || [], branchId);
  return enrichProduct(queryOne(`
    SELECT p.*, COALESCE(pbs.stock, 0) as stock,
           pc.name as category_name, pc.parent_id as category_parent_id,
           ppc.name as parent_category_name,
           COALESCE(ppc.sort_order, pc.sort_order, 999) as category_sort,
           COALESCE(pc.sort_order, 999) as subcategory_sort
    FROM products p
    LEFT JOIN product_branch_stock pbs ON pbs.product_id = p.id AND pbs.branch_id = ?
    LEFT JOIN product_categories pc ON pc.id = p.category_id
    LEFT JOIN product_categories ppc ON ppc.id = pc.parent_id
    WHERE p.id = ?
  `, [branchId, id]), branchId);
}

export function updateProduct(id, data, branchId = DEFAULT_BRANCH_ID) {
  const payload = normalizeProductPayload(data);
  payload.barcode = assertUniqueBarcode(payload.barcode, id);

  run(`
    UPDATE products
    SET name=?, sku=?, unit=?, price=?, category_id=?, barcode=?, net_weight=?, gross_weight=?,
        has_variants=?, updated_at=datetime('now')
    WHERE id=?
  `, [
    payload.name, payload.sku, payload.unit, payload.price,
    payload.category_id, payload.barcode || null,
    payload.net_weight, payload.gross_weight,
    payload.has_variants, id,
  ]);
  if (data.supplier_ids !== undefined) {
    setProductSuppliers(id, data.supplier_ids, branchId);
  }
  if (data.variants !== undefined || data.has_variants !== undefined) {
    saveProductVariants(id, !!payload.has_variants, data.variants || [], branchId);
  }
  return enrichProduct(queryOne(`
    SELECT p.*, COALESCE(pbs.stock, 0) as stock,
           pc.name as category_name, pc.parent_id as category_parent_id,
           ppc.name as parent_category_name,
           COALESCE(ppc.sort_order, pc.sort_order, 999) as category_sort,
           COALESCE(pc.sort_order, 999) as subcategory_sort
    FROM products p
    LEFT JOIN product_branch_stock pbs ON pbs.product_id = p.id AND pbs.branch_id = ?
    LEFT JOIN product_categories pc ON pc.id = p.category_id
    LEFT JOIN product_categories ppc ON ppc.id = pc.parent_id
    WHERE p.id = ?
  `, [branchId, id]), branchId);
}

export function deleteProduct(id) {
  const used = queryOne('SELECT COUNT(*) as c FROM document_items WHERE product_id = ?', [id]).c;
  if (used > 0) throw new Error('Товар используется в документах');
  const variants = queryAll('SELECT id FROM product_variants WHERE product_id = ?', [id]);
  for (const variant of variants) {
    deleteVariantImages(variant.id);
  }
  run('DELETE FROM product_variants WHERE product_id = ?', [id]);
  deleteAllProductImages(id);
  run('DELETE FROM product_suppliers WHERE product_id = ?', [id]);
  run('DELETE FROM product_department_stock WHERE product_id = ?', [id]);
  run('DELETE FROM product_branch_stock WHERE product_id = ?', [id]);
  run('DELETE FROM products WHERE id = ?', [id]);
}

export function getCounterparties(type, branchId = DEFAULT_BRANCH_ID) {
  let sql = 'SELECT * FROM counterparties WHERE branch_id = ?';
  const params = [branchId];
  if (type) {
    sql += ' AND type = ?';
    params.push(type);
  }
  sql += ' ORDER BY type, name';
  return queryAll(sql, params);
}

export function getCounterparty(id, branchId = null) {
  if (branchId) {
    return queryOne('SELECT * FROM counterparties WHERE id = ? AND branch_id = ?', [id, branchId]);
  }
  return queryOne('SELECT * FROM counterparties WHERE id = ?', [id]);
}

function assertCounterpartyBranch(counterpartyId, branchId, docType = null) {
  if (!counterpartyId) return;
  const cp = queryOne('SELECT id, type, branch_id FROM counterparties WHERE id = ?', [counterpartyId]);
  if (!cp) throw new Error('Контрагент не найден');
  if (cp.branch_id !== branchId) throw new Error('Контрагент принадлежит другому филиалу');
  if (isSupplierCounterpartyDoc(docType) && cp.type !== 'supplier') throw new Error('Для прихода/возврата нужен поставщик');
  if (docType === 'rashod' && cp.type !== 'client') throw new Error('Для расхода нужен клиент');
}

export function createCounterparty(data, branchId = DEFAULT_BRANCH_ID) {
  const id = uuidv4();
  run(`
    INSERT INTO counterparties (id, name, type, phone, email, telegram_chat_id, address, notes, branch_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id, data.name, data.type, data.phone || '', data.email || '',
    data.telegram_chat_id || '', data.address || '', data.notes || '', branchId,
  ]);
  return queryOne('SELECT * FROM counterparties WHERE id = ?', [id]);
}

export function updateCounterparty(id, data, branchId = DEFAULT_BRANCH_ID) {
  const existing = getCounterparty(id, branchId);
  if (!existing) throw new Error('Контрагент не найден');
  run(`
    UPDATE counterparties
    SET name=?, type=?, phone=?, email=?, telegram_chat_id=?, address=?, notes=?, updated_at=datetime('now')
    WHERE id=? AND branch_id=?
  `, [
    data.name, data.type, data.phone || '', data.email || '',
    data.telegram_chat_id || '', data.address || '', data.notes || '', id, branchId,
  ]);
  return queryOne('SELECT * FROM counterparties WHERE id = ?', [id]);
}

export function deleteCounterparty(id, branchId = DEFAULT_BRANCH_ID) {
  const existing = getCounterparty(id, branchId);
  if (!existing) throw new Error('Контрагент не найден');
  run('DELETE FROM counterparty_contracts WHERE counterparty_id = ? AND branch_id = ?', [id, branchId]);
  run('DELETE FROM product_suppliers WHERE supplier_id = ? AND branch_id = ?', [id, branchId]);
  run('DELETE FROM counterparties WHERE id = ? AND branch_id = ?', [id, branchId]);
}

export function getCounterpartyContracts(counterpartyId, branchId = DEFAULT_BRANCH_ID) {
  const cp = getCounterparty(counterpartyId, branchId);
  if (!cp) throw new Error('Контрагент не найден');

  const contracts = queryAll(`
    SELECT id, counterparty_id, branch_id, number, date, is_default, created_at
    FROM counterparty_contracts
    WHERE counterparty_id = ? AND branch_id = ?
    ORDER BY is_default DESC, date DESC, number
  `, [counterpartyId, branchId]);

  if (contracts.length === 0) {
    return [{
      id: DEFAULT_CONTRACT_ID,
      counterparty_id: counterpartyId,
      branch_id: branchId,
      number: 'Основной договор',
      date: null,
      is_default: 1,
      virtual: true,
    }];
  }

  return contracts;
}

export function createCounterpartyContract(counterpartyId, data, branchId = DEFAULT_BRANCH_ID) {
  const cp = getCounterparty(counterpartyId, branchId);
  if (!cp) throw new Error('Контрагент не найден');
  const number = (data.number || '').trim();
  if (!number) throw new Error('Укажите номер договора');

  const id = uuidv4();
  run(`
    INSERT INTO counterparty_contracts (id, counterparty_id, branch_id, number, date, is_default)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [id, counterpartyId, branchId, number, data.date || null, data.is_default ? 1 : 0]);

  return queryOne('SELECT * FROM counterparty_contracts WHERE id = ?', [id]);
}

export function deleteCounterpartyContract(counterpartyId, contractId, branchId = DEFAULT_BRANCH_ID) {
  if (contractId === DEFAULT_CONTRACT_ID) throw new Error('Нельзя удалить основной договор');
  const row = queryOne(
    'SELECT id FROM counterparty_contracts WHERE id = ? AND counterparty_id = ? AND branch_id = ?',
    [contractId, counterpartyId, branchId],
  );
  if (!row) throw new Error('Договор не найден');
  run('UPDATE documents SET contract_id = NULL WHERE contract_id = ?', [contractId]);
  run('DELETE FROM counterparty_contracts WHERE id = ?', [contractId]);
}

export function getDocuments(filters = {}) {
  let sql = `
    SELECT d.*, c.name as counterparty_name, c.type as counterparty_type,
           b.name as branch_name,
           fb.name as from_branch_name, tb.name as to_branch_name,
           fd.name as from_department_name, td.name as to_department_name
    FROM documents d
    LEFT JOIN counterparties c ON c.id = d.counterparty_id
    LEFT JOIN branches b ON b.id = d.branch_id
    LEFT JOIN branches fb ON fb.id = d.from_branch_id
    LEFT JOIN branches tb ON tb.id = d.to_branch_id
    LEFT JOIN departments fd ON fd.id = d.from_department_id
    LEFT JOIN departments td ON td.id = d.to_department_id
    WHERE 1=1
  `;
  const params = [];

  if (filters.branch_id) {
    sql += ` AND (
      d.branch_id = ? OR d.from_branch_id = ? OR d.to_branch_id = ?
    )`;
    params.push(filters.branch_id, filters.branch_id, filters.branch_id);
  }
  if (filters.type) {
    sql += ' AND d.type = ?';
    params.push(filters.type);
  }
  if (filters.status) {
    sql += ' AND d.status = ?';
    params.push(filters.status);
  }
  if (filters.date_from) {
    sql += ' AND d.date >= ?';
    params.push(filters.date_from);
  }
  if (filters.date_to) {
    sql += ' AND d.date <= ?';
    params.push(filters.date_to);
  }

  sql += ' ORDER BY d.date DESC, d.created_at DESC';
  return queryAll(sql, params);
}

export function getDocument(id, branchId = null) {
  const doc = queryOne(`
    SELECT d.*, c.name as counterparty_name, c.type as counterparty_type,
           c.phone as counterparty_phone, c.telegram_chat_id,
           cc.number as contract_number, cc.date as contract_date,
           b.name as branch_name,
           fb.name as from_branch_name, tb.name as to_branch_name,
           fd.name as from_department_name, td.name as to_department_name
    FROM documents d
    LEFT JOIN counterparties c ON c.id = d.counterparty_id
    LEFT JOIN counterparty_contracts cc ON cc.id = d.contract_id
    LEFT JOIN branches b ON b.id = d.branch_id
    LEFT JOIN branches fb ON fb.id = d.from_branch_id
    LEFT JOIN branches tb ON tb.id = d.to_branch_id
    LEFT JOIN departments fd ON fd.id = d.from_department_id
    LEFT JOIN departments td ON td.id = d.to_department_id
    WHERE d.id = ?
  `, [id]);

  if (!doc) return null;

  if (!doc.contract_id) {
    doc.contract_number = 'Основной договор';
    doc.contract_date = null;
  }

  const stockBranch = branchId || doc.branch_id || DEFAULT_BRANCH_ID;
  const stockDepartmentId = isOutgoingDocType(doc.type)
    ? doc.from_department_id
    : doc.type === 'prihod'
      ? doc.to_department_id
      : doc.type === 'razdelka'
        ? doc.from_department_id
        : null;

  let itemsSql;
  let itemsParams;
  if (stockDepartmentId) {
    itemsSql = `
      SELECT di.*, p.name as product_name, p.sku, p.unit,
             COALESCE(pds.stock, 0) as stock
      FROM document_items di
      JOIN products p ON p.id = di.product_id
      LEFT JOIN product_department_stock pds
        ON pds.product_id = p.id
        AND pds.department_id = ?
        AND IFNULL(pds.variant_id, '') = IFNULL(di.variant_id, '')
      WHERE di.document_id = ?
    `;
    itemsParams = [stockDepartmentId, id];
  } else {
    itemsSql = `
      SELECT di.*, p.name as product_name, p.sku, p.unit,
             COALESCE((
               SELECT SUM(pds2.stock)
               FROM product_department_stock pds2
               JOIN departments dep ON dep.id = pds2.department_id AND dep.branch_id = ?
               WHERE pds2.product_id = p.id
             ), COALESCE(pbs.stock, 0)) as stock
      FROM document_items di
      JOIN products p ON p.id = di.product_id
      LEFT JOIN product_branch_stock pbs ON pbs.product_id = p.id AND pbs.branch_id = ?
      WHERE di.document_id = ?
    `;
    itemsParams = [stockBranch, stockBranch, id];
  }
  const items = queryAll(itemsSql, itemsParams).map((row) => ({
    ...row,
    item_role: row.item_role || 'input',
  }));

  const input_items = items.filter((i) => i.item_role === 'input');
  const output_items = items.filter((i) => i.item_role === 'output');

  return { ...doc, items, input_items, output_items };
}

function validatePrihodItems(counterpartyId, items, branchId = DEFAULT_BRANCH_ID) {
  if (!counterpartyId || !items?.length) return;

  assertCounterpartyBranch(counterpartyId, branchId, 'prihod');

  for (const item of items) {
    if (!item.product_id) continue;
    const link = queryOne(
      'SELECT id FROM product_suppliers WHERE product_id = ? AND supplier_id = ? AND branch_id = ?',
      [item.product_id, counterpartyId, branchId],
    );
    if (!link) {
      const product = queryOne('SELECT name FROM products WHERE id = ?', [item.product_id]);
      throw new Error(`Товар «${product?.name || 'неизвестный'}» не привязан к выбранному поставщику в этом филиале`);
    }
  }
}

function normalizeItems(items) {
  const valid = (items || []).filter((i) => i.product_id);
  if (valid.length === 0) {
    throw new Error('Добавьте хотя бы один товар в документ');
  }
  return valid;
}

function normalizeRazdelkaItems(data) {
  const inputItems = (data.input_items || []).filter((i) => i.product_id);
  if (inputItems.length === 0) throw new Error('Добавьте сырьё (вход)');
  return { inputItems };
}


function getInputProcessedWeight(input, calcItems = []) {
  if (input.outputs && typeof input.outputs === 'object' && !Array.isArray(input.outputs)) {
    return Object.values(input.outputs).reduce((s, v) => s + (Number(v) || 0), 0);
  }
  if (Array.isArray(input.outputs)) {
    return input.outputs.reduce((s, o) => s + (Number(o.quantity) || 0), 0);
  }
  const legacy = (Number(input.toza) || 0) + (Number(input.qiymali) || 0) + (Number(input.otkhod) || 0);
  if (legacy > 0) return legacy;
  if (calcItems.length) {
    return calcItems.reduce((s, ci, idx) => {
      const keys = ['toza', 'qiymali', 'otkhod'];
      return s + (Number(input[keys[idx]]) || 0);
    }, 0);
  }
  return Number(input.quantity) || 0;
}

function expandInputOutputs(input, calcItems) {
  if (input.outputs && typeof input.outputs === 'object' && !Array.isArray(input.outputs)) {
    return calcItems.map((ci) => ({
      product_id: ci.product_id,
      variant_id: ci.variant_id || null,
      quantity: Number(input.outputs[calcLineKey(ci.product_id, ci.variant_id)]) || 0,
      is_waste: !!ci.is_waste,
    }));
  }
  if (Array.isArray(input.outputs)) {
    return input.outputs.map((o) => {
      const ci = calcItems.find((item) =>
        item.product_id === o.product_id
        && (item.variant_id || null) === (o.variant_id || null));
      return {
        product_id: o.product_id,
        variant_id: o.variant_id || null,
        quantity: Number(o.quantity) || 0,
        is_waste: ci ? !!ci.is_waste : !!o.is_waste,
      };
    });
  }

  const legacy = [
    { key: 'toza', idx: 0 },
    { key: 'qiymali', idx: 1 },
    { key: 'otkhod', idx: 2 },
  ];
  return calcItems.map((ci, idx) => {
    const legacyKey = legacy[idx]?.key;
    return {
      product_id: ci.product_id,
      variant_id: ci.variant_id || null,
      quantity: legacyKey ? (Number(input[legacyKey]) || 0) : 0,
      is_waste: !!ci.is_waste,
    };
  });
}

function buildRazdelkaOutputItemsFromInput(inputItems, calculationId) {
  if (!calculationId) {
    throw new Error('Выберите калькуляцию');
  }

  const calc = getCalculation(calculationId);
  if (!calc) throw new Error('Калькуляция не найдена');

  const calcItems = calc.items || [];
  const calcSources = calc.sources || [];
  if (calcItems.length === 0) {
    throw new Error('В калькуляции нет выходных товаров');
  }

  const outputs = [];

  for (const input of inputItems) {
    const rowOutputs = expandInputOutputs(input, calcItems);
    const weight = rowOutputs.reduce((s, o) => s + o.quantity, 0);
    if (weight <= 0) {
      throw new Error('Укажите количество по позициям калькуляции');
    }

    if (calcSources.length > 0 && !calcSources.some((s) =>
      s.product_id === input.product_id
      && (s.variant_id || null) === (input.variant_id || null))) {
      const product = queryOne('SELECT name FROM products WHERE id = ?', [input.product_id]);
      throw new Error(`«${product?.name || 'товар'}» не входит в выбранную калькуляцию`);
    }

    for (const row of rowOutputs) {
      if (row.quantity <= 0) continue;
      outputs.push({
        product_id: row.product_id,
        variant_id: row.variant_id || null,
        quantity: row.quantity,
        is_waste: !!row.is_waste,
        toza: 0,
        qiymali: 0,
        otkhod: 0,
      });
    }
  }

  const sellable = outputs.filter((o) => !o.is_waste);
  if (sellable.length === 0) {
    throw new Error('Укажите выход без отхода — на склад попадают только продаваемые позиции');
  }

  return outputs;
}

function enrichRazdelkaItemPrices(items, fromDepartmentId = null) {
  return items.map((item) => {
    if (item.price != null && item.price > 0) return item;
    if (fromDepartmentId) {
      const avgCost = getDepartmentAvgCost(fromDepartmentId, item.product_id, item.variant_id || null);
      if (avgCost > 0) return { ...item, price: avgCost };
    }
    const product = queryOne('SELECT price FROM products WHERE id = ?', [item.product_id]);
    return { ...item, price: product?.price || 0 };
  });
}

function insertDocumentItems(documentId, items, itemRole = 'input') {
  for (const item of items) {
    const toza = item.toza || 0;
    const qiymali = item.qiymali || 0;
    const otkhod = item.otkhod || 0;
    run(`
      INSERT INTO document_items (id, document_id, product_id, variant_id, quantity, price, amount, item_role, toza, qiymali, otkhod)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      uuidv4(),
      documentId,
      item.product_id,
      item.variant_id || null,
      item.quantity,
      item.price || 0,
      item.quantity * (item.price || 0),
      itemRole,
      toza,
      qiymali,
      otkhod,
    ]);
  }
}

function prepareRazdelkaOutputs(inputItems, outputItems, fromDepartmentId = null) {
  const enrichedInputs = enrichRazdelkaItemPrices(inputItems, fromDepartmentId);
  const inputTotal = enrichedInputs.reduce((s, i) => {
    const price = Number(i.price) || 0;
    const qty = getInputProcessedWeight(i);
    return s + qty * price;
  }, 0);

  const prepared = (outputItems || [])
    .filter((i) => i.product_id)
    .map((item) => {
      const quantity = Number(item.quantity) || (Number(item.toza) || 0) + (Number(item.qiymali) || 0);
      return {
        ...item,
        quantity,
        is_waste: !!item.is_waste,
        toza: Number(item.toza) || 0,
        qiymali: Number(item.qiymali) || 0,
        otkhod: Number(item.otkhod) || 0,
      };
    })
    .filter((i) => i.quantity > 0);

  if (prepared.length === 0) throw new Error('Добавьте продукцию после разделки');

  const sellableWeight = prepared
    .filter((i) => !i.is_waste)
    .reduce((s, i) => s + i.quantity, 0);
  if (sellableWeight <= 0) throw new Error('Укажите выход без отхода');
  const unitCost = inputTotal / sellableWeight;

  return prepared.map((i) => ({
    ...i,
    price: i.is_waste ? 0 : Math.round(unitCost * 100) / 100,
    quantity: i.is_waste ? 0 : i.quantity,
    toza: i.is_waste ? 0 : i.quantity,
    qiymali: 0,
    otkhod: i.is_waste ? i.quantity : (Number(i.otkhod) || 0),
  }));
}

function validateRazdelka(branchId, fromDept, toDept, inputItems, reverse = false, outputItems = [], allowSameDepartment = false) {
  if (!fromDept) throw new Error('Выберите отдел-источник (откуда сырьё)');
  if (!toDept) throw new Error('Выберите отдел, куда попадёт продукция');
  assertDepartmentInBranch(fromDept, branchId);
  assertDepartmentInBranch(toDept, branchId);
  if (!reverse && fromDept === toDept && !allowSameDepartment) {
    throw new Error('Отдел-источник и отдел-получатель должны отличаться');
  }
  if (reverse) {
    for (const item of outputItems) {
      const stock = getDepartmentStock(item.product_id, toDept, item.variant_id || null);
      if (stock < item.quantity) {
        throw new Error(`Недостаточно «${getItemStockLabel(item)}» в цехе для отмены (есть ${stock})`);
      }
    }
    return;
  }
  for (const item of inputItems) {
    const weight = getInputProcessedWeight(item);
    const qty = weight > 0 ? weight : Number(item.quantity) || 0;
    const stock = getDepartmentStock(item.product_id, fromDept, item.variant_id || null);
    if (stock < qty) {
      const label = getItemStockLabel(item);
      const unit = queryOne('SELECT unit FROM products WHERE id = ?', [item.product_id])?.unit || 'кг';
      throw new Error(`Недостаточно «${label}» в отделе-источнике: указано ${qty} ${unit}, есть ${stock} ${unit}`);
    }
  }
}

function calcRazdelkaTotal(outputItems) {
  return outputItems.reduce((s, i) => s + i.quantity * (i.price || 0), 0);
}

export function createDocument(data, userId = null, branchId = DEFAULT_BRANCH_ID) {
  if (data.type === 'razdelka') {
    const { inputItems } = normalizeRazdelkaItems(data);
    const calculationId = data.calculation_id || null;
    const docBranchId = data.branch_id || branchId;
    const fromDept = data.from_department_id || null;
    const toDept = data.to_department_id || null;
    const outputItems = buildRazdelkaOutputItemsFromInput(inputItems, calculationId);
    const enrichedInputs = enrichRazdelkaItemPrices(inputItems, fromDept);
    const enrichedOutputs = prepareRazdelkaOutputs(inputItems, outputItems, fromDept);

    validateRazdelka(docBranchId, fromDept, toDept, enrichedInputs, false, [], true);

    const id = uuidv4();
    const number = data.number || generateDocNumber(docBranchId, 'razdelka');
    const total = calcRazdelkaTotal(enrichedOutputs);
    const willConfirm = data.status === 'confirmed';

    if (willConfirm) {
      validateRazdelka(docBranchId, fromDept, toDept, enrichedInputs, false, [], true);
    }

    transaction(() => {
      run(`
        INSERT INTO documents (id, number, type, counterparty_id, date, comment, from_location, to_location,
          branch_id, from_branch_id, to_branch_id, from_department_id, to_department_id, total_amount, status, calculation_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        id, number, 'razdelka', null,
        data.date, data.comment || '', '', '',
        docBranchId, null, null, fromDept, toDept,
        total, data.status || 'draft', calculationId,
      ]);

      insertDocumentItems(id, enrichedInputs, 'input');
      insertDocumentItems(id, enrichedOutputs, 'output');
      addHistory(id, 'created', userId);

      if (willConfirm) {
        updateStock(id);
        addHistory(id, 'confirmed', userId);
      }
    });

    return getDocument(id, docBranchId);
  }

  const items = normalizeItems(data.items);

  const docBranchId = data.type === 'peremeshchenie'
    ? (data.from_branch_id || branchId)
    : (data.branch_id || branchId);
  const fromBranchId = data.type === 'peremeshchenie' ? (data.from_branch_id || branchId) : null;
  const toBranchId = data.type === 'peremeshchenie'
    ? (data.to_branch_id || data.from_branch_id || branchId)
    : null;
  const fromDepartmentId = data.type === 'peremeshchenie' ? (data.from_department_id || null) : null;
  let toDepartmentId = data.type === 'peremeshchenie' ? (data.to_department_id || null) : null;
  let rashodFromDepartmentId = null;

  if (data.type === 'prihod') {
    toDepartmentId = data.to_department_id || null;
    if (!toDepartmentId) throw new Error('Выберите отдел для прихода');
    assertDepartmentInBranch(toDepartmentId, docBranchId);
  }
  if (data.type === 'return_supplier' && !data.counterparty_id) {
    throw new Error('Выберите поставщика для возврата');
  }
  const sourceDocumentId = data.type === 'return_supplier' ? (data.source_document_id || null) : null;
  if (data.type === 'return_supplier') {
    assertReturnSupplierSourceDocument(sourceDocumentId, docBranchId, data.counterparty_id, data.date);
  }

  if (isOutgoingDocType(data.type)) {
    rashodFromDepartmentId = data.from_department_id || null;
    if (!rashodFromDepartmentId) throw new Error('Выберите отдел для расхода/возврата');
    assertDepartmentInBranch(rashodFromDepartmentId, docBranchId);
  }

  if (data.type !== 'peremeshchenie' && data.counterparty_id) {
    assertCounterpartyBranch(data.counterparty_id, docBranchId, data.type);
  }

  if (data.type === 'prihod' && data.counterparty_id) {
    validatePrihodItems(data.counterparty_id, items, docBranchId);
  }

  if (data.type === 'peremeshchenie') {
    if (fromDepartmentId) assertDepartmentInBranch(fromDepartmentId, fromBranchId);
    if (toDepartmentId) assertDepartmentInBranch(toDepartmentId, toBranchId || fromBranchId);
    validatePeremeshchenie(fromBranchId, toBranchId, fromDepartmentId, toDepartmentId, items);
  }

  const id = uuidv4();
  const number = data.number || generateDocNumber(docBranchId, data.type);
  const total = items.reduce((s, i) => s + i.quantity * i.price, 0);
  const willConfirm = data.status === 'confirmed';
  const contractId = isSupplierCounterpartyDoc(data.type)
    ? resolveDocumentContractId(data.contract_id, data.counterparty_id, docBranchId)
    : null;

  if (willConfirm) {
    if (isOutgoingDocType(data.type)) validateRashodStock(docBranchId, rashodFromDepartmentId, items);
    if (data.type === 'peremeshchenie') {
      validatePeremeshchenie(fromBranchId, toBranchId, fromDepartmentId, toDepartmentId, items);
    }
  }

  transaction(() => {
    run(`
      INSERT INTO documents (id, number, type, counterparty_id, contract_id, date, comment, from_location, to_location,
        branch_id, from_branch_id, to_branch_id, from_department_id, to_department_id, source_document_id, total_amount, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, number, data.type, data.counterparty_id || null, contractId,
      data.date, data.comment || '', data.from_location || '', data.to_location || '',
      docBranchId, fromBranchId, toBranchId,
      isOutgoingDocType(data.type) ? rashodFromDepartmentId : fromDepartmentId,
      toDepartmentId,
      sourceDocumentId,
      total, data.status || 'draft',
    ]);

    for (const item of items) {
      run(`
        INSERT INTO document_items (id, document_id, product_id, variant_id, quantity, price, amount, item_role)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'input')
      `, [uuidv4(), id, item.product_id, item.variant_id || null, item.quantity, item.price, item.quantity * item.price]);
    }

    addHistory(id, 'created', userId);

    if (willConfirm) {
      updateStock(id);
      addHistory(id, 'confirmed', userId);
    }
  });

  return getDocument(id, docBranchId);
}

export function updateDocument(id, data, userId = null, branchId = DEFAULT_BRANCH_ID) {
  const existing = queryOne('SELECT * FROM documents WHERE id = ?', [id]);
  if (!existing) throw new Error('Документ не найден');
  if (existing.status === 'cancelled') throw new Error('Отменённый документ нельзя редактировать');

  const docType = data.type || existing.type;

  if (docType === 'razdelka') {
    const { inputItems } = normalizeRazdelkaItems(data);
    const calculationId = data.calculation_id ?? existing.calculation_id ?? null;
    const docBranchId = data.branch_id || existing.branch_id || branchId;
    const fromDept = data.from_department_id ?? existing.from_department_id ?? null;
    const toDept = data.to_department_id ?? existing.to_department_id ?? null;
    const outputItems = buildRazdelkaOutputItemsFromInput(inputItems, calculationId);
    const enrichedInputs = enrichRazdelkaItemPrices(inputItems, fromDept);
    const enrichedOutputs = prepareRazdelkaOutputs(inputItems, outputItems, fromDept);
    const wasConfirmed = existing.status === 'confirmed';
    const willConfirm = data.status === 'confirmed' || (wasConfirmed && data.status !== 'draft');

    validateRazdelka(docBranchId, fromDept, toDept, enrichedInputs, false, [], true);

    transaction(() => {
      if (wasConfirmed) {
        assertRazdelkaCanReverse(id, existing);
        updateStock(id, true);
      }

      if (willConfirm && !wasConfirmed) {
        validateRazdelka(docBranchId, fromDept, toDept, enrichedInputs, false, [], true);
      }

      const total = calcRazdelkaTotal(enrichedOutputs);

      run(`
        UPDATE documents
        SET date=?, comment=?, branch_id=?, from_department_id=?, to_department_id=?,
            total_amount=?, status=?, calculation_id=?, updated_at=datetime('now')
        WHERE id=?
      `, [
        data.date,
        data.comment || '',
        docBranchId,
        fromDept,
        toDept,
        total,
        data.status || existing.status,
        calculationId,
        id,
      ]);

      run('DELETE FROM document_items WHERE document_id = ?', [id]);
      insertDocumentItems(id, enrichedInputs, 'input');
      insertDocumentItems(id, enrichedOutputs, 'output');
      addHistory(id, 'updated', userId);

      if (willConfirm) {
        updateStock(id);
        if (!wasConfirmed) addHistory(id, 'confirmed', userId);
      }
    });

    return getDocument(id, docBranchId);
  }

  const counterpartyId = data.counterparty_id ?? existing.counterparty_id;
  const items = normalizeItems(data.items);

  const docBranchId = docType === 'peremeshchenie'
    ? (data.from_branch_id || existing.from_branch_id || existing.branch_id || branchId)
    : (data.branch_id || existing.branch_id || branchId);
  const fromBranchId = docType === 'peremeshchenie'
    ? (data.from_branch_id || existing.from_branch_id || docBranchId)
    : null;
  const toBranchId = docType === 'peremeshchenie'
    ? (data.to_branch_id ?? existing.to_branch_id ?? fromBranchId)
    : null;
  const fromDepartmentId = docType === 'peremeshchenie'
    ? (data.from_department_id ?? existing.from_department_id ?? null)
    : null;
  let toDepartmentId = docType === 'peremeshchenie'
    ? (data.to_department_id ?? existing.to_department_id ?? null)
    : null;
  let rashodFromDepartmentId = null;

  if (docType === 'prihod') {
    toDepartmentId = data.to_department_id ?? existing.to_department_id ?? null;
    if (!toDepartmentId) throw new Error('Выберите отдел для прихода');
    assertDepartmentInBranch(toDepartmentId, docBranchId);
  }
  if (docType === 'return_supplier' && !counterpartyId) {
    throw new Error('Выберите поставщика для возврата');
  }
  const sourceDocumentId = docType === 'return_supplier'
    ? (data.source_document_id ?? existing.source_document_id ?? null)
    : null;
  const returnDate = data.date || existing.date;
  if (docType === 'return_supplier') {
    assertReturnSupplierSourceDocument(sourceDocumentId, docBranchId, counterpartyId, returnDate);
  }

  if (isOutgoingDocType(docType)) {
    rashodFromDepartmentId = data.from_department_id ?? existing.from_department_id ?? null;
    if (!rashodFromDepartmentId) throw new Error('Выберите отдел для расхода/возврата');
    assertDepartmentInBranch(rashodFromDepartmentId, docBranchId);
  }

  if (docType !== 'peremeshchenie' && counterpartyId) {
    assertCounterpartyBranch(counterpartyId, docBranchId, docType);
  }

  if (docType === 'prihod' && counterpartyId) {
    validatePrihodItems(counterpartyId, items, docBranchId);
  }

  if (docType === 'peremeshchenie') {
    if (fromDepartmentId) assertDepartmentInBranch(fromDepartmentId, fromBranchId);
    if (toDepartmentId) assertDepartmentInBranch(toDepartmentId, toBranchId || fromBranchId);
    validatePeremeshchenie(fromBranchId, toBranchId, fromDepartmentId, toDepartmentId, items);
  }

  const wasConfirmed = existing.status === 'confirmed';
  const willConfirm = data.status === 'confirmed' || (wasConfirmed && data.status !== 'draft');

  transaction(() => {
    if (wasConfirmed) updateStock(id, true);

    if (willConfirm && !wasConfirmed) {
      if (isOutgoingDocType(docType)) validateRashodStock(docBranchId, rashodFromDepartmentId, items);
      if (docType === 'peremeshchenie') {
        validatePeremeshchenie(fromBranchId, toBranchId, fromDepartmentId, toDepartmentId, items);
      }
    }

    const total = items.reduce((s, i) => s + i.quantity * i.price, 0);
    const savedFromDepartmentId = isOutgoingDocType(docType) ? rashodFromDepartmentId : fromDepartmentId;
    const contractId = isSupplierCounterpartyDoc(docType)
      ? resolveDocumentContractId(
        data.contract_id ?? (existing.contract_id || DEFAULT_CONTRACT_ID),
        counterpartyId,
        docBranchId,
      )
      : null;

    run(`
      UPDATE documents
      SET counterparty_id=?, contract_id=?, date=?, comment=?, from_location=?, to_location=?,
          branch_id=?, from_branch_id=?, to_branch_id=?, from_department_id=?, to_department_id=?, source_document_id=?,
          total_amount=?, status=?, updated_at=datetime('now')
      WHERE id=?
    `, [
      data.counterparty_id || null, contractId, data.date, data.comment || '',
      data.from_location || '', data.to_location || '',
      docBranchId, fromBranchId, toBranchId, savedFromDepartmentId, toDepartmentId, sourceDocumentId,
      total, data.status || existing.status, id,
    ]);

    run('DELETE FROM document_items WHERE document_id = ?', [id]);

    for (const item of items) {
      run(`
        INSERT INTO document_items (id, document_id, product_id, variant_id, quantity, price, amount, item_role)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'input')
      `, [uuidv4(), id, item.product_id, item.variant_id || null, item.quantity, item.price, item.quantity * item.price]);
    }

    addHistory(id, 'updated', userId);

    if (willConfirm) {
      updateStock(id);
      if (!wasConfirmed) addHistory(id, 'confirmed', userId);
    }
  });

  return getDocument(id, docBranchId);
}

export function confirmDocument(id, userId = null) {
  const doc = queryOne('SELECT * FROM documents WHERE id = ?', [id]);
  if (!doc) throw new Error('Документ не найден');
  if (doc.status === 'confirmed') return getDocument(id, doc.branch_id);
  if (doc.status === 'cancelled') throw new Error('Документ отменён');

  const items = queryAll('SELECT * FROM document_items WHERE document_id = ?', [id]);
  if (isOutgoingDocType(doc.type)) validateRashodStock(doc.branch_id || DEFAULT_BRANCH_ID, doc.from_department_id, items);
  if (doc.type === 'razdelka') {
    const inputItems = items.filter((i) => (i.item_role || 'input') === 'input');
    validateRazdelka(
      doc.branch_id || DEFAULT_BRANCH_ID,
      doc.from_department_id,
      doc.to_department_id,
      inputItems,
      false,
      [],
      true,
    );
  }
  if (doc.type === 'peremeshchenie') {
    validatePeremeshchenie(
      doc.from_branch_id || doc.branch_id,
      doc.to_branch_id || doc.from_branch_id || doc.branch_id,
      doc.from_department_id,
      doc.to_department_id,
      items,
    );
  }
  if (doc.type === 'return_supplier') {
    assertReturnSupplierSourceDocument(
      doc.source_document_id,
      doc.branch_id || DEFAULT_BRANCH_ID,
      doc.counterparty_id,
      doc.date,
    );
  }

  transaction(() => {
    run(`UPDATE documents SET status='confirmed', updated_at=datetime('now') WHERE id=?`, [id]);
    updateStock(id);
    addHistory(id, 'confirmed', userId);
  });

  return getDocument(id, doc.branch_id);
}

function assertRazdelkaCanReverse(documentId, doc) {
  if (doc.type !== 'razdelka') return;
  const items = queryAll('SELECT * FROM document_items WHERE document_id = ?', [documentId]);
  const outputItems = items.filter((i) => i.item_role === 'output');
  validateRazdelka(
    doc.branch_id || DEFAULT_BRANCH_ID,
    doc.from_department_id,
    doc.to_department_id,
    [],
    true,
    outputItems,
  );
}

export function cancelDocument(id, userId = null) {
  const doc = queryOne('SELECT * FROM documents WHERE id = ?', [id]);
  if (!doc) throw new Error('Документ не найден');
  if (doc.status === 'cancelled') return getDocument(id);

  if (doc.status === 'confirmed') assertRazdelkaCanReverse(id, doc);

  transaction(() => {
    if (doc.status === 'confirmed') updateStock(id, true);
    run(`UPDATE documents SET status='cancelled', updated_at=datetime('now') WHERE id=?`, [id]);
    addHistory(id, 'cancelled', userId);
  });

  return getDocument(id);
}

export function deleteDocument(id) {
  const doc = queryOne('SELECT * FROM documents WHERE id = ?', [id]);
  if (!doc) throw new Error('Документ не найден');
  const linkedReturns = queryOne('SELECT COUNT(*) as c FROM documents WHERE source_document_id = ?', [id])?.c || 0;
  if (linkedReturns > 0) {
    throw new Error('Нельзя удалить документ: к нему привязаны возвраты поставщику.');
  }
  const linkedPayments = queryOne('SELECT COUNT(*) as c FROM payments WHERE document_id = ?', [id])?.c || 0;
  if (linkedPayments > 0) {
    throw new Error('Нельзя удалить документ: есть привязанные оплаты. Сначала отвяжите или удалите оплаты.');
  }

  if (doc.status === 'confirmed') assertRazdelkaCanReverse(id, doc);

  transaction(() => {
    if (doc.status === 'confirmed') {
      updateStock(id, true);
    }
    run('DELETE FROM telegram_messages WHERE document_id = ?', [id]);
    run('DELETE FROM documents WHERE id = ?', [id]);
  });

  return { ok: true, number: doc.number };
}

function formatChangedBy(row) {
  if (row.changed_by_name) return row.changed_by_name;
  if (!row.changed_by || row.changed_by === 'user') return 'Не указан';
  if (row.changed_by === 'system') return 'Система';
  return row.changed_by;
}

export function getDocumentHistory(documentId) {
  return queryAll(`
    SELECT h.id, h.document_id, h.action, h.snapshot, h.changed_by, h.created_at,
           u.name as changed_by_name
    FROM document_history h
    LEFT JOIN users u ON u.id = h.changed_by
    WHERE h.document_id = ?
    ORDER BY h.created_at DESC
  `, [documentId]).map((row) => ({
    ...row,
    user_name: formatChangedBy(row),
  }));
}

export function getStockReport(branchId = DEFAULT_BRANCH_ID, departmentId = null, onlyInStock = true) {
  let sql = `
    SELECT pds.stock, COALESCE(pds.avg_cost, 0) as avg_cost, pds.variant_id,
           p.id as product_id, p.name as product_name, p.unit, p.category_id,
           pv.name as variant_name,
           d.id as department_id, d.name as department_name,
           pc.name as category_name
    FROM product_department_stock pds
    JOIN departments d ON d.id = pds.department_id AND d.branch_id = ?
    JOIN products p ON p.id = pds.product_id
    LEFT JOIN product_variants pv ON pv.id = pds.variant_id
    LEFT JOIN product_categories pc ON pc.id = p.category_id
    WHERE (
      COALESCE(p.has_variants, 0) = 0 AND (pds.variant_id IS NULL OR pds.variant_id = '')
      OR COALESCE(p.has_variants, 0) = 1 AND pds.variant_id IS NOT NULL AND pds.variant_id != ''
    )
  `;
  const params = [branchId];
  if (departmentId) {
    sql += ' AND pds.department_id = ?';
    params.push(departmentId);
  }
  if (onlyInStock) {
    sql += ' AND pds.stock > 0';
  }
  sql += ' ORDER BY d.name, p.name, COALESCE(pv.sort_order, 999), pv.name';

  const rows = queryAll(sql, params);

  // Для выбранного отдела и режима "показывать нулевые" добавляем товары без движения.
  if (!onlyInStock && departmentId) {
    const missingProducts = queryAll(`
      SELECT p.id as product_id, p.name as product_name, p.unit, p.category_id,
             pc.name as category_name, d.id as department_id, d.name as department_name
      FROM products p
      JOIN departments d ON d.id = ? AND d.branch_id = ?
      LEFT JOIN product_categories pc ON pc.id = p.category_id
      WHERE COALESCE(p.has_variants, 0) = 0
        AND NOT EXISTS (
          SELECT 1
          FROM product_department_stock pds
          WHERE pds.department_id = d.id
            AND pds.product_id = p.id
            AND (pds.variant_id IS NULL OR pds.variant_id = '')
        )
      ORDER BY p.name
    `, [departmentId, branchId]);

    for (const product of missingProducts) {
      rows.push({
        ...product,
        variant_id: null,
        variant_name: null,
        stock: 0,
        avg_cost: 0,
      });
    }
  }

  return rows.map((row) => {
    const stock = row.stock || 0;
    const unitCost = row.avg_cost || 0;
    const name = row.variant_name
      ? `${row.product_name} — ${row.variant_name}`
      : row.product_name;
    return {
      rowKey: `${row.department_id}:${row.product_id}:${row.variant_id || ''}`,
      department_id: row.department_id,
      department_name: row.department_name,
      name,
      category_id: row.category_id,
      category_name: row.category_name,
      unit: row.unit || 'шт',
      stock,
      unitCost,
      total: stock * unitCost,
    };
  });
}

function getCounterpartyDebtRows(branchId, counterpartyType, docType, paymentType, includeUnlinkedPayments = true) {
  const rows = queryAll(`
    SELECT c.id, c.name, c.phone, c.email,
      COALESCE((
        SELECT SUM(d.total_amount)
        FROM documents d
        WHERE d.counterparty_id = c.id
          AND d.type = ?
          AND d.status = 'confirmed'
          AND d.branch_id = ?
      ), 0) AS charged,
      COALESCE((
        SELECT SUM(p.amount)
        FROM payments p
        LEFT JOIN documents d ON d.id = p.document_id
        WHERE p.branch_id = ?
          AND p.type = ?
          AND (
            (
              p.document_id IS NOT NULL
              AND d.id IS NOT NULL
              AND d.status = 'confirmed'
              AND d.type = ?
              AND d.counterparty_id = c.id
            )
            OR (
              ? = 1
              AND p.document_id IS NULL
              AND p.counterparty_id = c.id
            )
          )
      ), 0) AS paid
    FROM counterparties c
    WHERE c.branch_id = ? AND c.type = ?
    ORDER BY c.name
  `, [
    docType,
    branchId,
    branchId,
    paymentType,
    docType,
    includeUnlinkedPayments ? 1 : 0,
    branchId,
    counterpartyType,
  ]);

  return rows.map((row) => {
    const charged = row.charged || 0;
    const paid = row.paid || 0;
    const balance = charged - paid;
    return {
      id: row.id,
      name: row.name,
      phone: row.phone || '',
      email: row.email || '',
      charged,
      paid,
      balance,
    };
  });
}

/** Дебиторы — клиенты, которые должны нам (расход − оплаты) */
export function getDebtorsReport(branchId = DEFAULT_BRANCH_ID, includeZero = false, includeUnlinkedPayments = true) {
  const rows = getCounterpartyDebtRows(
    branchId,
    'client',
    'rashod',
    'customer_income',
    includeUnlinkedPayments,
  );
  const filtered = includeZero
    ? rows.filter((r) => r.charged > 0 || r.paid > 0)
    : rows.filter((r) => r.balance > 0.005);
  const totalBalance = filtered.reduce((s, r) => s + r.balance, 0);
  return {
    kind: 'debtors',
    title: 'Дебиторы',
    subtitle: 'Клиенты, которые должны нам',
    rows: filtered,
    total_balance: totalBalance,
    count: filtered.length,
  };
}

/** Кредиторы — поставщики, которым мы должны (приход − оплаты) */
export function getCreditorsReport(branchId = DEFAULT_BRANCH_ID, includeZero = false, includeUnlinkedPayments = true) {
  const rows = getCounterpartyDebtRows(
    branchId,
    'supplier',
    'prihod',
    'supplier_payment',
    includeUnlinkedPayments,
  );
  const returnedRows = queryAll(`
    SELECT counterparty_id, COALESCE(SUM(total_amount), 0) as returned
    FROM documents
    WHERE branch_id = ?
      AND type = 'return_supplier'
      AND status = 'confirmed'
      AND counterparty_id IS NOT NULL
    GROUP BY counterparty_id
  `, [branchId]);
  const returnedMap = new Map(returnedRows.map((r) => [r.counterparty_id, r.returned || 0]));

  const adjusted = rows.map((r) => {
    const returned = returnedMap.get(r.id) || 0;
    const charged = (r.charged || 0) - returned;
    const paid = r.paid || 0;
    return {
      ...r,
      returned,
      charged,
      balance: charged - paid,
    };
  });

  const filtered = includeZero
    ? adjusted.filter((r) => r.charged > 0 || r.paid > 0 || r.returned > 0)
    : adjusted.filter((r) => r.balance > 0.005);
  const totalBalance = filtered.reduce((s, r) => s + r.balance, 0);
  return {
    kind: 'creditors',
    title: 'Кредиторы',
    subtitle: 'Поставщики, которым мы должны',
    rows: filtered,
    total_balance: totalBalance,
    count: filtered.length,
  };
}

export function getStats(branchId = DEFAULT_BRANCH_ID) {
  const products = queryOne('SELECT COUNT(*) as c FROM products').c;
  const stock = queryOne(`
    SELECT COALESCE(SUM(pds.stock * pds.avg_cost), 0) as v
    FROM product_department_stock pds
    JOIN departments d ON d.id = pds.department_id
    WHERE d.branch_id = ?
  `, [branchId]).v;
  const prihod = queryOne(`
    SELECT COALESCE(SUM(total_amount), 0) as v FROM documents
    WHERE type='prihod' AND status='confirmed' AND branch_id = ?
  `, [branchId]).v;
  const rashod = queryOne(`
    SELECT COALESCE(SUM(total_amount), 0) as v FROM documents
    WHERE type='rashod' AND status='confirmed' AND branch_id = ?
  `, [branchId]).v;
  const docs = queryOne(
    'SELECT COUNT(*) as c FROM documents WHERE branch_id = ? OR from_branch_id = ? OR to_branch_id = ?',
    [branchId, branchId, branchId],
  ).c;

  const branchFilter = [branchId, branchId, branchId];

  const docsByType = queryAll(`
    SELECT type, COUNT(*) as count, COALESCE(SUM(total_amount), 0) as total
    FROM documents
    WHERE branch_id = ? OR from_branch_id = ? OR to_branch_id = ?
    GROUP BY type
  `, branchFilter);

  const docsByStatus = queryAll(`
    SELECT status, COUNT(*) as count
    FROM documents
    WHERE branch_id = ? OR from_branch_id = ? OR to_branch_id = ?
    GROUP BY status
  `, branchFilter);

  const monthlyActivity = queryAll(`
    SELECT strftime('%Y-%m', date) as month,
           COUNT(*) as count,
           COALESCE(SUM(total_amount), 0) as total
    FROM documents
    WHERE status = 'confirmed'
      AND (branch_id = ? OR from_branch_id = ? OR to_branch_id = ?)
      AND date >= date('now', 'start of month', '-5 months')
    GROUP BY month
    ORDER BY month ASC
  `, branchFilter);

  const topProducts = queryAll(`
    SELECT p.id, p.name, p.unit,
           COALESCE(pbs.stock, 0) as stock,
           COALESCE(p.price, 0) as price,
           COALESCE(pbs.stock * p.price, 0) as value
    FROM product_branch_stock pbs
    JOIN products p ON p.id = pbs.product_id
    WHERE pbs.branch_id = ? AND pbs.stock > 0
    ORDER BY value DESC
    LIMIT 6
  `, [branchId]);

  const lowStock = queryAll(`
    SELECT p.name, p.unit, pbs.stock
    FROM product_branch_stock pbs
    JOIN products p ON p.id = pbs.product_id
    WHERE pbs.branch_id = ? AND pbs.stock > 0 AND pbs.stock <= 10
    ORDER BY pbs.stock ASC, p.name
    LIMIT 6
  `, [branchId]);

  const confirmedDocs = queryOne(`
    SELECT COUNT(*) as c FROM documents
    WHERE status = 'confirmed'
      AND (branch_id = ? OR from_branch_id = ? OR to_branch_id = ?)
  `, branchFilter).c;

  const draftDocs = queryOne(`
    SELECT COUNT(*) as c FROM documents
    WHERE status = 'draft'
      AND (branch_id = ? OR from_branch_id = ? OR to_branch_id = ?)
  `, branchFilter).c;

  return {
    products,
    stockValue: stock,
    prihodTotal: prihod,
    rashodTotal: rashod,
    documents: docs,
    confirmedDocs,
    draftDocs,
    branchId,
    docsByType,
    docsByStatus,
    monthlyActivity,
    topProducts,
    lowStock,
  };
}

export function logTelegramMessage(data) {
  const id = uuidv4();
  run(`
    INSERT INTO telegram_messages (id, counterparty_id, document_id, chat_id, message, status, error)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    id, data.counterparty_id || null, data.document_id || null,
    data.chat_id, data.message, data.status, data.error || null
  ]);
  return id;
}

export function getTelegramMessages(limit = 50) {
  return queryAll(`
    SELECT tm.*, c.name as counterparty_name, d.number as document_number
    FROM telegram_messages tm
    LEFT JOIN counterparties c ON c.id = tm.counterparty_id
    LEFT JOIN documents d ON d.id = tm.document_id
    ORDER BY tm.created_at DESC
    LIMIT ?
  `, [limit]);
}

export function getSetting(key) {
  const row = queryOne('SELECT value FROM settings WHERE key = ?', [key]);
  return row?.value || null;
}

export function setSetting(key, value) {
  const existing = queryOne('SELECT key FROM settings WHERE key = ?', [key]);
  if (existing) {
    run('UPDATE settings SET value = ?, updated_at = datetime(\'now\') WHERE key = ?', [value, key]);
  } else {
    run('INSERT INTO settings (key, value) VALUES (?, ?)', [key, value]);
  }
  return value;
}

export function deleteSetting(key) {
  run('DELETE FROM settings WHERE key = ?', [key]);
}

export function maskToken(token) {
  if (!token || token.length < 12) return token ? '••••••••' : '';
  return `${token.slice(0, 8)}...${token.slice(-4)}`;
}

export function getTelegramSettings() {
  const token = getSetting('telegram_bot_token');
  return {
    hasToken: !!token,
    tokenMasked: maskToken(token),
    updatedAt: queryOne('SELECT updated_at FROM settings WHERE key = ?', ['telegram_bot_token'])?.updated_at || null,
  };
}

export function saveTelegramToken(token) {
  const trimmed = (token || '').trim();
  if (!trimmed) throw new Error('Токен не может быть пустым');
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(trimmed)) {
    throw new Error('Неверный формат токена. Пример: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz');
  }
  setSetting('telegram_bot_token', trimmed);
  return getTelegramSettings();
}

export function removeTelegramToken() {
  deleteSetting('telegram_bot_token');
  return getTelegramSettings();
}

function generatePaymentNumber(branchId = DEFAULT_BRANCH_ID) {
  const rows = queryAll('SELECT number FROM payments WHERE branch_id = ? OR (branch_id IS NULL AND ? = ?)', [branchId, branchId, DEFAULT_BRANCH_ID]);
  let max = 0;
  for (const row of rows) {
    const n = parseInt(row.number, 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return String(max + 1);
}

export function getPayments(branchId = null) {
  let sql = `
    SELECT p.*, c.name as counterparty_name, c.type as counterparty_type,
           d.number as document_number, u.name as created_by_name,
           b.name as branch_name, ca.name as article_name, ca.direction as article_direction
    FROM payments p
    LEFT JOIN counterparties c ON c.id = p.counterparty_id
    LEFT JOIN documents d ON d.id = p.document_id
    LEFT JOIN users u ON u.id = p.created_by
    LEFT JOIN branches b ON b.id = p.branch_id
    LEFT JOIN cash_articles ca ON ca.id = p.article_id
  `;
  const params = [];
  if (branchId) {
    sql += ' WHERE p.branch_id = ?';
    params.push(branchId);
  }
  sql += ' ORDER BY p.date DESC, p.created_at DESC';
  return queryAll(sql, params);
}

export function getCashArticles(direction = null) {
  let sql = 'SELECT id, name, direction, sort_order FROM cash_articles WHERE active = 1';
  const params = [];
  if (direction) {
    sql += ' AND direction = ?';
    params.push(direction);
  }
  sql += ' ORDER BY sort_order, name';
  return queryAll(sql, params);
}

const PURCHASE_ARTICLE_ID = 'ca_exp_purchase';

export function getCashArticlesAll() {
  return queryAll(`
    SELECT ca.*,
      (SELECT COUNT(*) FROM payments p WHERE p.article_id = ca.id) AS usage_count
    FROM cash_articles ca
    ORDER BY ca.direction, ca.sort_order, ca.name
  `);
}

export function createCashArticle(data) {
  const name = (data.name || '').trim();
  if (!name) throw new Error('Укажите название статьи');
  if (!['income', 'expense'].includes(data.direction)) {
    throw new Error('Укажите направление: приход или расход');
  }
  const id = uuidv4();
  const sortOrder = Number.isFinite(Number(data.sort_order)) ? Number(data.sort_order) : 0;
  const active = data.active === false ? 0 : 1;
  run(
    'INSERT INTO cash_articles (id, name, direction, sort_order, active) VALUES (?, ?, ?, ?, ?)',
    [id, name, data.direction, sortOrder, active],
  );
  return queryOne('SELECT *, 0 AS usage_count FROM cash_articles WHERE id = ?', [id]);
}

export function updateCashArticle(id, data) {
  const existing = queryOne('SELECT * FROM cash_articles WHERE id = ?', [id]);
  if (!existing) throw new Error('Статья не найдена');

  const name = data.name !== undefined ? String(data.name).trim() : existing.name;
  if (!name) throw new Error('Укажите название статьи');

  let direction = data.direction ?? existing.direction;
  if (id === PURCHASE_ARTICLE_ID && direction !== 'expense') {
    throw new Error('Статья «Закуп» должна оставаться расходом');
  }
  if (!['income', 'expense'].includes(direction)) {
    throw new Error('Неверное направление');
  }

  const sortOrder = data.sort_order !== undefined
    ? Number(data.sort_order)
    : existing.sort_order;
  const active = data.active !== undefined ? (data.active ? 1 : 0) : existing.active;

  if (id === PURCHASE_ARTICLE_ID && !active) {
    throw new Error('Статью «Закуп» нельзя отключить');
  }

  run(
    'UPDATE cash_articles SET name = ?, direction = ?, sort_order = ?, active = ? WHERE id = ?',
    [name, direction, sortOrder, active, id],
  );

  return queryOne(`
    SELECT ca.*,
      (SELECT COUNT(*) FROM payments p WHERE p.article_id = ca.id) AS usage_count
    FROM cash_articles ca
    WHERE ca.id = ?
  `, [id]);
}

export function deleteCashArticle(id) {
  if (id === PURCHASE_ARTICLE_ID) {
    throw new Error('Системную статью «Закуп» нельзя удалить');
  }
  const existing = queryOne('SELECT * FROM cash_articles WHERE id = ?', [id]);
  if (!existing) throw new Error('Статья не найдена');

  const usage = queryOne('SELECT COUNT(*) AS c FROM payments WHERE article_id = ?', [id]).c;
  if (usage > 0) {
    run('UPDATE cash_articles SET active = 0 WHERE id = ?', [id]);
    return { deactivated: true };
  }

  run('DELETE FROM cash_articles WHERE id = ?', [id]);
  return { deactivated: false };
}

function paymentTodayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function assertPaymentShiftAccess(userRole, ...dates) {
  if (!userRole || hasPermission(userRole, 'payments.edit_past') || hasPermission(userRole, 'cashier.edit_past')) return;
  const today = paymentTodayIso();
  for (const date of dates) {
    if (date && date !== today) {
      throw new Error('Нельзя изменять операции за прошлые даты');
    }
  }
}

function assertCashArticle(articleId, paymentType) {
  if (!articleId) return null;
  const article = queryOne('SELECT * FROM cash_articles WHERE id = ? AND active = 1', [articleId]);
  if (!article) throw new Error('Статья не найдена');
  const isIncome = paymentType === 'other_income' || paymentType === 'customer_income';
  if (isIncome && article.direction !== 'income') throw new Error('Статья не подходит для прихода');
  if (!isIncome && article.direction !== 'expense') throw new Error('Статья не подходит для расхода');
  return article;
}

function assertPurchasePayment(data, payBranchId) {
  if (data.article_id !== PURCHASE_ARTICLE_ID) return;
  if (!data.counterparty_id) throw new Error('Выберите поставщика');
  if (data.type !== 'supplier_payment') throw new Error('Для статьи «Закуп» нужна оплата поставщику');
  assertCounterpartyBranch(data.counterparty_id, payBranchId, 'prihod');
}

function assertPaymentBranchAccess(paymentBranchId, requestedBranchId) {
  if (!requestedBranchId) return;
  if (paymentBranchId && paymentBranchId !== requestedBranchId) {
    throw new Error('Оплата принадлежит другому филиалу');
  }
}

function assertPaymentDocumentLink(documentId, paymentType, payBranchId, counterpartyId = null) {
  if (!documentId) return null;
  const doc = queryOne(
    'SELECT id, type, status, branch_id, counterparty_id FROM documents WHERE id = ?',
    [documentId],
  );
  if (!doc) throw new Error('Связанный документ не найден');
  if (doc.status !== 'confirmed') {
    throw new Error('Привязать оплату можно только к проведённому документу');
  }
  if (doc.type !== 'prihod' && doc.type !== 'rashod') {
    throw new Error('Оплаты можно привязывать только к документам прихода/расхода');
  }
  if (doc.branch_id !== payBranchId) {
    throw new Error('Документ принадлежит другому филиалу');
  }
  if (paymentType === 'supplier_payment' && doc.type !== 'prihod') {
    throw new Error('Оплата поставщику привязывается только к документу прихода');
  }
  if (paymentType === 'customer_income' && doc.type !== 'rashod') {
    throw new Error('Оплата от клиента привязывается только к документу расхода');
  }
  if (paymentType === 'other_income' || paymentType === 'other_expense') {
    throw new Error('Для прочих операций не указывайте связанный документ');
  }
  if (counterpartyId && doc.counterparty_id && counterpartyId !== doc.counterparty_id) {
    throw new Error('Контрагент оплаты не совпадает с контрагентом документа');
  }
  return doc;
}

export function createPayment(data, userId = null, branchId = DEFAULT_BRANCH_ID, userRole = null) {
  const id = uuidv4();
  const payBranchId = branchId || data.branch_id || DEFAULT_BRANCH_ID;
  if (branchId && data.branch_id && data.branch_id !== branchId) {
    throw new Error('Нет доступа к выбранному филиалу');
  }
  const number = data.number || generatePaymentNumber(payBranchId);
  if (!data.amount || data.amount <= 0) throw new Error('Укажите сумму больше нуля');
  assertPaymentShiftAccess(userRole, data.date);
  assertCashArticle(data.article_id, data.type);
  assertPurchasePayment(data, payBranchId);
  assertPaymentDocumentLink(data.document_id || null, data.type, payBranchId, data.counterparty_id || null);

  if (data.counterparty_id) {
    let typeCheck = null;
    if (data.type === 'supplier_payment') typeCheck = 'prihod';
    else if (data.type === 'customer_income') typeCheck = 'rashod';
    assertCounterpartyBranch(data.counterparty_id, payBranchId, typeCheck);
  }

  run(`
    INSERT INTO payments (id, number, type, counterparty_id, document_id, amount, date, comment, created_by, branch_id, article_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id, number, data.type, data.counterparty_id || null, data.document_id || null,
    data.amount, data.date, data.comment || '', userId, payBranchId, data.article_id,
  ]);

  return queryOne(`
    SELECT p.*, c.name as counterparty_name, d.number as document_number, ca.name as article_name
    FROM payments p
    LEFT JOIN counterparties c ON c.id = p.counterparty_id
    LEFT JOIN documents d ON d.id = p.document_id
    LEFT JOIN cash_articles ca ON ca.id = p.article_id
    WHERE p.id = ?
  `, [id]);
}

export function updatePayment(id, data, branchId = DEFAULT_BRANCH_ID, userRole = null) {
  const existing = queryOne('SELECT * FROM payments WHERE id = ?', [id]);
  if (!existing) throw new Error('Оплата не найдена');
  assertPaymentBranchAccess(existing.branch_id || DEFAULT_BRANCH_ID, branchId);
  if (data.branch_id && data.branch_id !== (existing.branch_id || branchId)) {
    throw new Error('Нельзя изменить филиал оплаты');
  }

  const newDate = data.date || existing.date;
  assertPaymentShiftAccess(userRole, existing.date, newDate);

  const counterpartyId = data.counterparty_id !== undefined
    ? data.counterparty_id
    : existing.counterparty_id;
  const payBranchId = existing.branch_id || branchId;
  const payType = data.type || existing.type;
  const articleId = data.article_id ?? existing.article_id;
  const documentId = data.document_id !== undefined ? data.document_id : existing.document_id;
  assertCashArticle(articleId, payType);
  assertPurchasePayment({ ...data, article_id: articleId, type: payType, counterparty_id: counterpartyId }, payBranchId);
  assertPaymentDocumentLink(documentId, payType, payBranchId, counterpartyId);
  if (counterpartyId) {
    let typeCheck = null;
    if (payType === 'supplier_payment') typeCheck = 'prihod';
    else if (payType === 'customer_income') typeCheck = 'rashod';
    assertCounterpartyBranch(counterpartyId, payBranchId, typeCheck);
  }

  run(`
    UPDATE payments
    SET type=?, counterparty_id=?, document_id=?, amount=?, date=?, comment=?, article_id=?
    WHERE id=?
  `, [
    payType,
    counterpartyId,
    documentId,
    data.amount ?? existing.amount,
    data.date || existing.date,
    data.comment ?? existing.comment,
    articleId,
    id,
  ]);

  return queryOne(`
    SELECT p.*, c.name as counterparty_name, d.number as document_number, ca.name as article_name
    FROM payments p
    LEFT JOIN counterparties c ON c.id = p.counterparty_id
    LEFT JOIN documents d ON d.id = p.document_id
    LEFT JOIN cash_articles ca ON ca.id = p.article_id
    WHERE p.id = ?
  `, [id]);
}

export function deletePayment(id, userRole = null, branchId = DEFAULT_BRANCH_ID) {
  const existing = queryOne('SELECT * FROM payments WHERE id = ?', [id]);
  if (!existing) throw new Error('Оплата не найдена');
  assertPaymentBranchAccess(existing.branch_id || DEFAULT_BRANCH_ID, branchId);
  assertPaymentShiftAccess(userRole, existing.date);
  run('DELETE FROM payments WHERE id = ?', [id]);
}

export { snapshotDocument, addHistory };
