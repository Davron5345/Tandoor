import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { adjustBranchStock, getBranchStock, DEFAULT_BRANCH_ID } from '../branches.js';
import {
  assertDepartmentInBranch,
  getDefaultDepartmentId,
  getDepartmentStock,
  syncBranchStockFromDepartments,
} from '../departments.js';
import {
  getDepartmentAvgCost,
  getVariantBranchStock,
  issueDepartmentStock,
  receiveDepartmentStock,
  reverseIssueDepartmentStock,
  reverseReceiveDepartmentStock,
  reverseTransferDepartmentStock,
  syncVariantCatalogStock,
  transferDepartmentStock,
} from '../inventoryCost.js';
import { getEffectiveProductPrice } from '../productBranches.js';
import { getCalculation, calcLineKey } from '../calculations.js';
import {
  DEFAULT_CONTRACT_ID,
  isSupplierCounterpartyDoc,
  assertCounterpartyBranch,
} from './counterparties.js';

const { queryAll, queryOne, run, transaction } = db;

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

export function snapshotDocument(docId) {
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

export function addHistory(documentId, action, userId = null) {
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
        const issued = issueDepartmentStock(doc.from_department_id, item.product_id, qty, vid);
        if (doc.type === 'rashod') {
          run(
            'UPDATE document_items SET unit_cost = ?, cost_amount = ? WHERE id = ?',
            [issued.unitCost, issued.totalCost, item.id],
          );
        }
      } else {
        reverseIssueDepartmentStock(
          doc.from_department_id,
          item.product_id,
          qty,
          item.unit_cost || item.price || 0,
          vid,
        );
        if (doc.type === 'rashod') {
          run('UPDATE document_items SET unit_cost = 0, cost_amount = 0 WHERE id = ?', [item.id]);
        }
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

function enrichRazdelkaItemPrices(items, fromDepartmentId = null, branchId = DEFAULT_BRANCH_ID) {
  return items.map((item) => {
    if (item.price != null && item.price > 0) return item;
    if (fromDepartmentId) {
      const avgCost = getDepartmentAvgCost(fromDepartmentId, item.product_id, item.variant_id || null);
      if (avgCost > 0) return { ...item, price: avgCost };
    }
    const price = getEffectiveProductPrice(item.product_id, branchId, item.variant_id || null);
    return { ...item, price };
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

function prepareRazdelkaOutputs(inputItems, outputItems, fromDepartmentId = null, branchId = DEFAULT_BRANCH_ID) {
  const enrichedInputs = enrichRazdelkaItemPrices(inputItems, fromDepartmentId, branchId);
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
    const enrichedInputs = enrichRazdelkaItemPrices(inputItems, fromDept, docBranchId);
    const enrichedOutputs = prepareRazdelkaOutputs(inputItems, outputItems, fromDept, docBranchId);

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
    const enrichedInputs = enrichRazdelkaItemPrices(inputItems, fromDept, docBranchId);
    const enrichedOutputs = prepareRazdelkaOutputs(inputItems, outputItems, fromDept, docBranchId);
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