import db from './db.js';

const { queryOne } = db;

export const PRODUCT_KIND_GOODS = 'goods';
export const PRODUCT_KIND_RAW = 'raw';
export const PRODUCT_KIND_SEMI = 'semi_finished';
export const PRODUCT_KIND_DISH = 'dish';

export const PRODUCT_KINDS = [
  PRODUCT_KIND_GOODS,
  PRODUCT_KIND_RAW,
  PRODUCT_KIND_SEMI,
  PRODUCT_KIND_DISH,
];

export const PRODUCT_KIND_LABELS = {
  [PRODUCT_KIND_GOODS]: 'Товар',
  [PRODUCT_KIND_RAW]: 'Сырьё',
  [PRODUCT_KIND_SEMI]: 'Полуфабрикат',
  [PRODUCT_KIND_DISH]: 'Готовое блюдо',
};

export const INGREDIENT_KINDS = [PRODUCT_KIND_RAW, PRODUCT_KIND_SEMI];
export const DISH_OUTPUT_KINDS = [PRODUCT_KIND_DISH];
export const RAZDELKA_OUTPUT_KINDS = [PRODUCT_KIND_SEMI, PRODUCT_KIND_GOODS];
export const RETAIL_SALE_KINDS = [PRODUCT_KIND_GOODS];
export const MYSHOP_KINDS = [PRODUCT_KIND_RAW, PRODUCT_KIND_SEMI];

export function normalizeProductKind(kind) {
  return PRODUCT_KINDS.includes(kind) ? kind : PRODUCT_KIND_GOODS;
}

export function parseProductKindFilter(value) {
  if (!value) return null;
  const kinds = String(value)
    .split(',')
    .map((k) => k.trim())
    .filter((k) => PRODUCT_KINDS.includes(k));
  return kinds.length ? kinds : null;
}

export function productKindLabel(kind) {
  return PRODUCT_KIND_LABELS[normalizeProductKind(kind)] || PRODUCT_KIND_LABELS[PRODUCT_KIND_GOODS];
}

export function assertProductKindById(productId, allowedKinds, roleLabel) {
  if (!productId || !allowedKinds?.length) return;
  const row = queryOne('SELECT id, name, product_kind FROM products WHERE id = ?', [productId]);
  if (!row) throw new Error('Товар не найден');
  assertProductKindRow(row, allowedKinds, roleLabel);
}

export function assertProductKindRow(productRow, allowedKinds, roleLabel) {
  if (!productRow?.product_id && !productRow?.id) return;
  const kind = normalizeProductKind(productRow.product_kind);
  if (!allowedKinds.includes(kind)) {
    const name = productRow.product_name || productRow.name || 'товар';
    throw new Error(`«${name}» не подходит как ${roleLabel}. Вид: «${productKindLabel(kind)}».`);
  }
}
