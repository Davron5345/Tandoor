import { v4 as uuidv4 } from 'uuid';
import db from './db.js';
import { DEFAULT_BRANCH_ID } from './branches.js';

export const CALC_KIND_RAZDELKA = 'razdelka';
export const CALC_KIND_RECIPE = 'recipe';

const { queryAll, queryOne, run, transaction } = db;

export function calcLineKey(productId, variantId = null) {
  if (!productId) return '';
  if (variantId) return `v:${variantId}`;
  return `p:${productId}`;
}

function formatCalcLine(row) {
  const display_name = row.variant_name
    ? `${row.product_name} — ${row.variant_name}`
    : row.product_name;
  return { ...row, display_name };
}

function getCalculationSources(calculationId) {
  return queryAll(`
    SELECT cs.*, p.name as product_name, p.unit, pv.name as variant_name
    FROM calculation_sources cs
    JOIN products p ON p.id = cs.product_id
    LEFT JOIN product_variants pv ON pv.id = cs.variant_id
    WHERE cs.calculation_id = ?
    ORDER BY cs.sort_order, p.name, pv.name
  `, [calculationId]).map(formatCalcLine);
}

function getCalculationItems(calculationId) {
  return queryAll(`
    SELECT ci.*, p.name as product_name, p.unit, p.price as catalog_price, pv.name as variant_name
    FROM calculation_items ci
    JOIN products p ON p.id = ci.product_id
    LEFT JOIN product_variants pv ON pv.id = ci.variant_id
    WHERE ci.calculation_id = ?
    ORDER BY ci.sort_order, p.name, pv.name
  `, [calculationId]).map((row) => formatCalcLine({
    ...row,
    is_waste: !!row.is_waste,
  }));
}

function enrichCalculation(row) {
  if (!row) return null;
  const sources = getCalculationSources(row.id);
  const items = getCalculationItems(row.id);
  const firstSource = sources[0];
  return {
    ...row,
    active: !!row.active,
    kind: row.kind === CALC_KIND_RECIPE ? CALC_KIND_RECIPE : CALC_KIND_RAZDELKA,
    sources,
    items,
    output_count: items.length,
    source_product_id: firstSource?.product_id || row.source_product_id,
    source_product_name: firstSource?.display_name || firstSource?.product_name || row.source_product_name,
    source_variant_id: firstSource?.variant_id || null,
    source_unit: firstSource?.unit || row.source_unit,
    base_quantity: firstSource?.quantity || row.base_quantity || 1,
  };
}

export function getCalculations(branchId = DEFAULT_BRANCH_ID, activeOnly = false, kind = null) {
  let sql = `
    SELECT c.*,
           cs.product_id as source_product_id,
           cs.variant_id as source_variant_id,
           p.name as source_product_name,
           pv.name as source_variant_name,
           p.unit as source_unit,
           cs.quantity as base_quantity
    FROM calculations c
    LEFT JOIN calculation_sources cs ON cs.calculation_id = c.id AND cs.sort_order = (
      SELECT MIN(sort_order) FROM calculation_sources WHERE calculation_id = c.id
    )
    LEFT JOIN products p ON p.id = cs.product_id
    LEFT JOIN product_variants pv ON pv.id = cs.variant_id
    WHERE c.branch_id = ?
  `;
  const params = [branchId];
  if (activeOnly) {
    sql += ' AND c.active = 1';
  }
  if (kind === CALC_KIND_RECIPE || kind === CALC_KIND_RAZDELKA) {
    sql += ' AND c.kind = ?';
    params.push(kind);
  }
  sql += ' ORDER BY c.name';
  return queryAll(sql, params).map((row) => {
    const count = queryOne(
      'SELECT COUNT(*) as c FROM calculation_items WHERE calculation_id = ?',
      [row.id],
    ).c;
    const sourceIds = queryAll(
      'SELECT product_id FROM calculation_sources WHERE calculation_id = ? ORDER BY sort_order',
      [row.id],
    ).map((s) => s.product_id);
    return {
      ...row,
      active: !!row.active,
      kind: row.kind === CALC_KIND_RECIPE ? CALC_KIND_RECIPE : CALC_KIND_RAZDELKA,
      source_product_name: row.source_variant_name
        ? `${row.source_product_name} — ${row.source_variant_name}`
        : row.source_product_name,
      output_count: count,
      source_product_ids: sourceIds,
    };
  });
}

export function getCalculation(id, branchId = null) {
  const row = queryOne(`
    SELECT c.*,
           p.name as source_product_name,
           p.unit as source_unit,
           p.price as source_catalog_price
    FROM calculations c
    LEFT JOIN calculation_sources cs ON cs.calculation_id = c.id AND cs.sort_order = (
      SELECT MIN(sort_order) FROM calculation_sources WHERE calculation_id = c.id
    )
    LEFT JOIN products p ON p.id = cs.product_id
    WHERE c.id = ?
  `, [id]);
  if (!row) return null;
  if (branchId && row.branch_id !== branchId) return null;
  return enrichCalculation(row);
}

function normalizeSources(data, kind = CALC_KIND_RAZDELKA) {
  let sources = (data.sources || []).filter((s) => s.product_id);
  if (sources.length === 0 && data.source_product_id) {
    sources = [{
      product_id: data.source_product_id,
      variant_id: data.source_variant_id || null,
      quantity: Number(data.base_quantity) || 1,
    }];
  }
  if (sources.length === 0) {
    throw new Error(kind === CALC_KIND_RECIPE ? 'Добавьте ингредиенты' : 'Добавьте сырьё (вход)');
  }
  return sources.map((s, idx) => ({
    product_id: s.product_id,
    variant_id: s.variant_id || null,
    quantity: Number(s.quantity) || 0,
    sort_order: s.sort_order ?? idx,
  })).filter((s) => s.quantity > 0);
}

function normalizeItems(items, kind = CALC_KIND_RAZDELKA) {
  const valid = (items || []).filter((i) => i.product_id);
  if (valid.length === 0) {
    throw new Error(kind === CALC_KIND_RECIPE ? 'Добавьте блюдо (выход)' : 'Добавьте хотя бы одну выходную позицию');
  }
  return valid;
}

function saveCalculationSources(calculationId, sources) {
  run('DELETE FROM calculation_sources WHERE calculation_id = ?', [calculationId]);
  sources.forEach((source, idx) => {
    run(`
      INSERT INTO calculation_sources (id, calculation_id, product_id, variant_id, quantity, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      uuidv4(),
      calculationId,
      source.product_id,
      source.variant_id || null,
      source.quantity,
      source.sort_order ?? idx,
    ]);
  });
}

function saveCalculationItems(calculationId, items) {
  run('DELETE FROM calculation_items WHERE calculation_id = ?', [calculationId]);
  items.forEach((item, idx) => {
    run(`
      INSERT INTO calculation_items (id, calculation_id, product_id, variant_id, quantity, price, sort_order, is_waste)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      uuidv4(),
      calculationId,
      item.product_id,
      item.variant_id || null,
      item.quantity,
      item.price || 0,
      item.sort_order ?? idx,
      item.is_waste ? 1 : 0,
    ]);
  });
}

function assertCalcLine(line) {
  if (!line?.product_id) throw new Error('Укажите товар');
  const product = queryOne('SELECT id FROM products WHERE id = ?', [line.product_id]);
  if (!product) throw new Error('Товар не найден');
  if (line.variant_id) {
    const variant = queryOne(
      'SELECT id FROM product_variants WHERE id = ? AND product_id = ?',
      [line.variant_id, line.product_id],
    );
    if (!variant) throw new Error('Вариант товара не найден');
  }
}

export function applyCalculation(calculationId, inputQuantity, inputPrice, branchId = DEFAULT_BRANCH_ID) {
  const calc = getCalculation(calculationId, branchId);
  if (!calc) throw new Error('Калькуляция не найдена');
  if (!calc.active) throw new Error('Калькуляция отключена');

  const qty = Number(inputQuantity);
  const price = Number(inputPrice);
  if (!qty || qty <= 0) throw new Error('Укажите количество сырья больше нуля');
  if (price < 0) throw new Error('Цена не может быть отрицательной');

  const baseQty = calc.base_quantity || 1;
  const scale = qty / baseQty;
  const inputTotal = qty * price;

  const outputs = calc.items.map((item, idx) => ({
    product_id: item.product_id,
    variant_id: item.variant_id || null,
    product_name: item.display_name || item.product_name,
    unit: item.unit,
    quantity: Math.round(item.quantity * scale * 1000) / 1000,
    fixed_price: item.price > 0 ? item.price : null,
    is_waste: !!item.is_waste,
    sort_order: item.sort_order ?? idx,
  }));

  const fixedTotal = outputs.reduce(
    (s, o) => s + (o.fixed_price != null && !o.is_waste ? o.fixed_price * o.quantity : 0),
    0,
  );
  const autoOutputs = outputs.filter((o) => o.fixed_price == null && !o.is_waste);
  const autoQty = autoOutputs.reduce((s, o) => s + o.quantity, 0);
  const remainingCost = Math.max(0, inputTotal - fixedTotal);

  const resultOutputs = outputs.map((o) => {
    if (o.is_waste) {
      return {
        product_id: o.product_id,
        variant_id: o.variant_id || null,
        product_name: o.product_name,
        unit: o.unit,
        quantity: o.quantity,
        price: 0,
        amount: 0,
        price_mode: 'waste',
        is_waste: true,
      };
    }
    if (o.fixed_price != null) {
      return {
        product_id: o.product_id,
        variant_id: o.variant_id || null,
        product_name: o.product_name,
        unit: o.unit,
        quantity: o.quantity,
        price: o.fixed_price,
        amount: o.quantity * o.fixed_price,
        price_mode: 'fixed',
        is_waste: false,
      };
    }
    const unitPrice = autoQty > 0
      ? Math.round((remainingCost / autoQty) * 100) / 100
      : 0;
    return {
      product_id: o.product_id,
      variant_id: o.variant_id || null,
      product_name: o.product_name,
      unit: o.unit,
      quantity: o.quantity,
      price: unitPrice,
      amount: o.quantity * unitPrice,
      price_mode: 'auto',
      is_waste: false,
    };
  });

  const outputTotal = resultOutputs.reduce((s, o) => s + o.amount, 0);
  const primarySource = calc.sources[0];

  return {
    calculation_id: calc.id,
    calculation_name: calc.name,
    source_product_id: primarySource?.product_id || calc.source_product_id,
    source_variant_id: primarySource?.variant_id || null,
    source_product_name: primarySource?.display_name || primarySource?.product_name || calc.source_product_name,
    source_unit: primarySource?.unit || calc.source_unit,
    base_quantity: baseQty,
    input_quantity: qty,
    input_price: price,
    input_total: inputTotal,
    output_total: outputTotal,
    sources: calc.sources,
    input_items: calc.sources.map((source) => ({
      product_id: source.product_id,
      variant_id: source.variant_id || null,
      product_name: source.display_name || source.product_name,
      unit: source.unit,
      quantity: Math.round(source.quantity * scale * 1000) / 1000,
      price,
      amount: Math.round(source.quantity * scale * 1000) / 1000 * price,
    })),
    output_items: resultOutputs,
  };
}

export function createCalculation(data, branchId = DEFAULT_BRANCH_ID) {
  const name = (data.name || '').trim();
  if (!name) throw new Error('Укажите название калькуляции');
  const kind = data.kind === CALC_KIND_RECIPE ? CALC_KIND_RECIPE : CALC_KIND_RAZDELKA;

  const sources = normalizeSources(data, kind);
  const primarySource = sources[0];
  sources.forEach(assertCalcLine);

  const items = normalizeItems(data.items, kind).map((item, idx) => ({
    ...item,
    variant_id: item.variant_id || null,
    sort_order: item.sort_order ?? idx,
    is_waste: !!item.is_waste,
  }));
  items.forEach(assertCalcLine);
  if (kind === CALC_KIND_RECIPE && !items.some((item) => !item.is_waste)) {
    throw new Error('Добавьте блюдо (выход рецепта) без отметки «Отход»');
  }

  const id = uuidv4();
  transaction(() => {
    run(`
      INSERT INTO calculations (id, branch_id, name, source_product_id, base_quantity, active, comment, kind)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      branchId,
      name,
      primarySource.product_id,
      primarySource.quantity,
      data.active !== false ? 1 : 0,
      data.comment || '',
      kind,
    ]);

    saveCalculationSources(id, sources);
    saveCalculationItems(id, items);
  });

  return getCalculation(id);
}

export function updateCalculation(id, data, branchId = DEFAULT_BRANCH_ID) {
  const existing = getCalculation(id, branchId);
  if (!existing) throw new Error('Калькуляция не найдена');

  const name = (data.name || existing.name).trim();
  if (!name) throw new Error('Укажите название калькуляции');
  const kind = data.kind === CALC_KIND_RECIPE
    ? CALC_KIND_RECIPE
    : (data.kind === CALC_KIND_RAZDELKA ? CALC_KIND_RAZDELKA : (existing.kind || CALC_KIND_RAZDELKA));

  const sources = normalizeSources({
    sources: data.sources,
    source_product_id: data.source_product_id || existing.source_product_id,
    base_quantity: data.base_quantity ?? existing.base_quantity,
  }, kind);
  const primarySource = sources[0];

  const items = normalizeItems(data.items, kind).map((item, idx) => ({
    ...item,
    variant_id: item.variant_id || null,
    sort_order: item.sort_order ?? idx,
    is_waste: !!item.is_waste,
  }));
  sources.forEach(assertCalcLine);
  items.forEach(assertCalcLine);
  if (kind === CALC_KIND_RECIPE && !items.some((item) => !item.is_waste)) {
    throw new Error('Добавьте блюдо (выход рецепта) без отметки «Отход»');
  }

  transaction(() => {
    run(`
      UPDATE calculations
      SET name=?, source_product_id=?, base_quantity=?, active=?, comment=?, kind=?, updated_at=datetime('now')
      WHERE id=? AND branch_id=?
    `, [
      name,
      primarySource.product_id,
      primarySource.quantity,
      data.active !== undefined ? (data.active ? 1 : 0) : existing.active,
      data.comment ?? existing.comment ?? '',
      kind,
      id,
      branchId,
    ]);

    saveCalculationSources(id, sources);
    saveCalculationItems(id, items);
  });

  return getCalculation(id);
}

export function deleteCalculation(id, branchId = DEFAULT_BRANCH_ID) {
  const existing = getCalculation(id, branchId);
  if (!existing) throw new Error('Калькуляция не найдена');
  transaction(() => {
    run('DELETE FROM calculation_sources WHERE calculation_id = ?', [id]);
    run('DELETE FROM calculation_items WHERE calculation_id = ?', [id]);
    run('DELETE FROM calculations WHERE id = ? AND branch_id = ?', [id, branchId]);
  });
  return { ok: true };
}

export function findCalculationForSourceProduct(productId, branchId = DEFAULT_BRANCH_ID) {
  const row = queryOne(`
    SELECT c.id
    FROM calculations c
    JOIN calculation_sources cs ON cs.calculation_id = c.id
    WHERE c.branch_id = ? AND c.active = 1 AND cs.product_id = ?
    ORDER BY c.name
    LIMIT 1
  `, [branchId, productId]);
  return row?.id || null;
}
