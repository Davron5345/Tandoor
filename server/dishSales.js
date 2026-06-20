import { v4 as uuidv4 } from 'uuid';
import db from './db.js';
import { DEFAULT_BRANCH_ID } from './branches.js';
import { getDepartmentStock } from './departments.js';
import { getDepartmentAvgCost } from './inventoryCost.js';
import { getCalculation, CALC_KIND_RAZDELKA, CALC_KIND_RECIPE } from './calculations.js';

const { queryOne, queryAll, run } = db;

function normalizeKind(kind) {
  return kind === CALC_KIND_RECIPE ? CALC_KIND_RECIPE : CALC_KIND_RAZDELKA;
}

export function findRecipeForDish(productId, variantId = null, branchId = DEFAULT_BRANCH_ID) {
  if (!productId) return null;
  const row = queryOne(`
    SELECT c.id
    FROM calculations c
    JOIN calculation_items ci ON ci.calculation_id = c.id
    JOIN products p ON p.id = ci.product_id
    WHERE c.branch_id = ?
      AND c.active = 1
      AND c.kind = 'recipe'
      AND ci.product_id = ?
      AND IFNULL(ci.variant_id, '') = IFNULL(?, '')
      AND COALESCE(ci.is_waste, 0) = 0
      AND p.product_kind = 'dish'
    ORDER BY c.name
    LIMIT 1
  `, [branchId, productId, variantId || null]);
  return row?.id || null;
}

export function getDishRecipes(branchId = DEFAULT_BRANCH_ID) {
  const calcs = queryAll(`
    SELECT c.id, c.name, c.comment, c.active
    FROM calculations c
    WHERE c.branch_id = ? AND c.kind = 'recipe' AND c.active = 1
    ORDER BY c.name
  `, [branchId]);

  return calcs.map((calc) => {
    const dishes = queryAll(`
      SELECT ci.product_id, ci.variant_id, ci.quantity, p.name as product_name, p.unit, p.price,
             p.product_kind, pv.name as variant_name
      FROM calculation_items ci
      JOIN products p ON p.id = ci.product_id
      LEFT JOIN product_variants pv ON pv.id = ci.variant_id
      WHERE ci.calculation_id = ? AND COALESCE(ci.is_waste, 0) = 0
        AND p.product_kind = 'dish'
      ORDER BY ci.sort_order, p.name
    `, [calc.id]).map((row) => ({
      ...row,
      display_name: row.variant_name ? `${row.product_name} — ${row.variant_name}` : row.product_name,
      batch_quantity: row.quantity || 1,
    }));
    const ingredientCount = queryOne(
      'SELECT COUNT(*) as c FROM calculation_sources WHERE calculation_id = ?',
      [calc.id],
    )?.c || 0;
    return { ...calc, dishes, ingredient_count: ingredientCount };
  }).filter((c) => c.dishes.length > 0);
}

export function computeRecipeConsumption(
  calculationId,
  dishProductId,
  dishVariantId,
  soldQty,
  departmentId,
  branchId = DEFAULT_BRANCH_ID,
) {
  const calc = getCalculation(calculationId, branchId);
  if (!calc) throw new Error('Рецепт не найден');
  if (normalizeKind(calc.kind) !== CALC_KIND_RECIPE) {
    throw new Error('Выбранная калькуляция не является рецептом блюда');
  }
  if (!calc.active) throw new Error('Рецепт отключён');

  const qty = Number(soldQty);
  if (!qty || qty <= 0) throw new Error('Укажите количество блюд больше нуля');

  const dishItem = (calc.items || []).find((item) =>
    item.product_id === dishProductId
    && (item.variant_id || null) === (dishVariantId || null)
    && !item.is_waste,
  );
  if (!dishItem) throw new Error('Блюдо не входит в выбранный рецепт');

  const batchSize = Number(dishItem.quantity) || 1;
  const scale = qty / batchSize;
  const sources = calc.sources || [];
  if (sources.length === 0) throw new Error('В рецепте нет ингредиентов');

  const consumption = [];
  let totalCost = 0;

  for (const source of sources) {
    const ingQty = Math.round(source.quantity * scale * 1000) / 1000;
    if (ingQty <= 0) continue;
    const unitCost = getDepartmentAvgCost(departmentId, source.product_id, source.variant_id || null);
    const lineCost = Math.round(unitCost * ingQty * 100) / 100;
    totalCost += lineCost;
    consumption.push({
      product_id: source.product_id,
      variant_id: source.variant_id || null,
      product_name: source.display_name || source.product_name,
      unit: source.unit,
      quantity: ingQty,
      unit_cost: unitCost,
      cost_amount: lineCost,
    });
  }

  if (consumption.length === 0) {
    throw new Error('Не удалось рассчитать списание ингредиентов');
  }

  return {
    calculation_id: calc.id,
    calculation_name: calc.name,
    batch_size: batchSize,
    sold_quantity: qty,
    total_cost: Math.round(totalCost * 100) / 100,
    unit_cost: Math.round((totalCost / qty) * 100) / 100,
    consumption,
  };
}

export function previewDishSaleLine(line, departmentId, branchId = DEFAULT_BRANCH_ID) {
  const productId = line.product_id;
  const variantId = line.variant_id || null;
  const qty = Number(line.quantity);
  if (!productId || !qty || qty <= 0) {
    throw new Error('Укажите блюдо и количество');
  }
  if (!departmentId) throw new Error('Выберите склад списания ингредиентов');

  const calculationId = line.calculation_id || findRecipeForDish(productId, variantId, branchId);
  if (!calculationId) throw new Error('Для этого блюда нет активного рецепта');

  return computeRecipeConsumption(calculationId, productId, variantId, qty, departmentId, branchId);
}

function mergeConsumptionLines(lines) {
  const map = new Map();
  for (const line of lines) {
    const key = `${line.product_id}:${line.variant_id || ''}`;
    const existing = map.get(key);
    if (existing) {
      existing.quantity = Math.round((existing.quantity + line.quantity) * 1000) / 1000;
      existing.cost_amount = Math.round((existing.cost_amount + line.cost_amount) * 100) / 100;
    } else {
      map.set(key, { ...line });
    }
  }
  return [...map.values()];
}

export function validateConsumptionStock(consumptionLines, departmentId, branchId = DEFAULT_BRANCH_ID) {
  for (const line of consumptionLines) {
    const stock = getDepartmentStock(line.product_id, departmentId, line.variant_id || null);
    if (stock + 1e-9 < line.quantity) {
      const label = line.product_name || line.product_id;
      const unit = line.unit || 'шт';
      throw new Error(
        `Недостаточно «${label}» на складе: нужно ${line.quantity} ${unit}, есть ${stock} ${unit}`,
      );
    }
  }
}

export function buildDishSalePlan(saleLines, departmentId, branchId = DEFAULT_BRANCH_ID) {
  const preparedSales = [];
  const allConsumption = [];

  for (const line of saleLines) {
    if (!line.product_id) continue;
    const qty = Number(line.quantity);
    const price = Number(line.price);
    if (!qty || qty <= 0) throw new Error('Укажите количество по каждому блюду');
    if (price < 0) throw new Error('Цена продажи не может быть отрицательной');

    const recipe = previewDishSaleLine(line, departmentId, branchId);
    preparedSales.push({
      ...line,
      quantity: qty,
      price,
      amount: Math.round(qty * price * 100) / 100,
      calculation_id: recipe.calculation_id,
      calculation_name: recipe.calculation_name,
      unit_cost: recipe.unit_cost,
      cost_amount: recipe.total_cost,
    });
    allConsumption.push(...recipe.consumption);
  }

  if (preparedSales.length === 0) {
    throw new Error('Добавьте хотя бы одно блюдо');
  }

  const consumption = mergeConsumptionLines(allConsumption);
  validateConsumptionStock(consumption, departmentId, branchId);

  return { saleLines: preparedSales, consumption };
}

export function applyDishSaleConsumption(documentId, departmentId, branchId = DEFAULT_BRANCH_ID) {
  const saleLines = queryAll(`
    SELECT * FROM document_items
    WHERE document_id = ? AND item_role = 'sale'
  `, [documentId]);

  const { saleLines: prepared, consumption } = buildDishSalePlan(saleLines, departmentId, branchId);

  run('DELETE FROM document_items WHERE document_id = ? AND item_role = ?', [documentId, 'consumption']);

  for (const line of prepared) {
    run(`
      UPDATE document_items
      SET unit_cost = ?, cost_amount = ?, amount = ?
      WHERE id = ?
    `, [line.unit_cost, line.cost_amount, line.amount, line.id]);
  }

  for (const line of consumption) {
    run(`
      INSERT INTO document_items
        (id, document_id, product_id, variant_id, quantity, price, amount, item_role, unit_cost, cost_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'consumption', ?, ?)
    `, [
      uuidv4(),
      documentId,
      line.product_id,
      line.variant_id || null,
      line.quantity,
      line.unit_cost,
      line.cost_amount,
      line.unit_cost,
      line.cost_amount,
    ]);
  }
}
