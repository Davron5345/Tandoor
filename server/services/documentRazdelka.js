import db from '../db.js';
import { DEFAULT_BRANCH_ID } from '../branches.js';
import { assertDepartmentInBranch, getDepartmentStock } from '../departments.js';
import { getDepartmentAvgCost } from '../inventoryCost.js';
import { getEffectiveProductPrice } from '../productBranches.js';
import { getCalculation, calcLineKey } from '../calculations.js';
import { getItemStockLabel } from './documentCore.js';

const { queryOne } = db;

export function normalizeRazdelkaItems(data) {
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

export function buildRazdelkaOutputItemsFromInput(inputItems, calculationId, branchId = null) {
  if (!calculationId) {
    throw new Error('Выберите калькуляцию');
  }

  const calc = getCalculation(calculationId, branchId);
  if (!calc) throw new Error('Калькуляция не найдена');
  if (calc.kind === 'recipe') {
    throw new Error('Для разделки выберите калькуляцию разделки, не рецепт блюда');
  }

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

export function enrichRazdelkaItemPrices(items, fromDepartmentId = null, branchId = DEFAULT_BRANCH_ID) {
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

export function prepareRazdelkaOutputs(inputItems, outputItems, fromDepartmentId = null, branchId = DEFAULT_BRANCH_ID) {
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

export function validateRazdelka(branchId, fromDept, toDept, inputItems, reverse = false, outputItems = [], allowSameDepartment = false) {
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

export function calcRazdelkaTotal(outputItems) {
  return outputItems.reduce((s, i) => s + i.quantity * (i.price || 0), 0);
}
