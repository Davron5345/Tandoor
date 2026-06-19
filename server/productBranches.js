import { v4 as uuidv4 } from 'uuid';
import db from './db.js';
import { getBranches, DEFAULT_BRANCH_ID } from './branches.js';

const { queryAll, queryOne, run } = db;

export function isProductVisibleInBranch(productId, branchId) {
  const row = queryOne(
    'SELECT visible FROM product_branches WHERE product_id = ? AND branch_id = ?',
    [productId, branchId],
  );
  return !!row?.visible;
}

export function getEffectiveProductPrice(productId, branchId, variantId = null) {
  if (variantId) {
    const row = queryOne(`
      SELECT COALESCE(pvb.price, pv.price, p.price, 0) as price
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      LEFT JOIN product_variant_branches pvb ON pvb.variant_id = pv.id AND pvb.branch_id = ?
      WHERE pv.id = ? AND pv.product_id = ?
    `, [branchId, variantId, productId]);
    return row?.price ?? 0;
  }

  const row = queryOne(`
    SELECT COALESCE(pb.price, p.price, 0) as price
    FROM products p
    LEFT JOIN product_branches pb ON pb.product_id = p.id AND pb.branch_id = ?
    WHERE p.id = ?
  `, [branchId, productId]);
  return row?.price ?? 0;
}

export function upsertProductBranch(productId, branchId, { visible = true, price = null } = {}) {
  const normalizedPrice = price === '' || price == null || Number.isNaN(Number(price))
    ? null
    : Number(price);
  const existing = queryOne(
    'SELECT id FROM product_branches WHERE product_id = ? AND branch_id = ?',
    [productId, branchId],
  );
  if (existing) {
    run(
      `UPDATE product_branches
       SET visible = ?, price = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [visible ? 1 : 0, normalizedPrice, existing.id],
    );
    return existing.id;
  }
  const id = uuidv4();
  run(
    `INSERT INTO product_branches (id, product_id, branch_id, visible, price)
     VALUES (?, ?, ?, ?, ?)`,
    [id, productId, branchId, visible ? 1 : 0, normalizedPrice],
  );
  return id;
}

export function upsertVariantBranchPrice(variantId, branchId, price = null) {
  const normalizedPrice = price === '' || price == null || Number.isNaN(Number(price))
    ? null
    : Number(price);
  const existing = queryOne(
    'SELECT id FROM product_variant_branches WHERE variant_id = ? AND branch_id = ?',
    [variantId, branchId],
  );
  if (existing) {
    run(
      `UPDATE product_variant_branches
       SET price = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [normalizedPrice, existing.id],
    );
    return;
  }
  run(
    `INSERT INTO product_variant_branches (id, variant_id, branch_id, price)
     VALUES (?, ?, ?, ?)`,
    [uuidv4(), variantId, branchId, normalizedPrice],
  );
}

export function ensureProductBranchOnCreate(productId, branchId = DEFAULT_BRANCH_ID) {
  upsertProductBranch(productId, branchId, { visible: true, price: null });
}

export function saveProductBranchSettings(productId, settings = []) {
  if (!Array.isArray(settings)) return;

  for (const item of settings) {
    if (!item?.branch_id) continue;
    upsertProductBranch(productId, item.branch_id, {
      visible: item.visible !== false,
      price: item.price,
    });

    if (Array.isArray(item.variants)) {
      for (const variant of item.variants) {
        if (!variant?.variant_id) continue;
        upsertVariantBranchPrice(variant.variant_id, item.branch_id, variant.price);
      }
    }
  }
}

export function getVariantBranchPriceMap(productId) {
  const rows = queryAll(`
    SELECT pvb.variant_id, pvb.branch_id, pvb.price
    FROM product_variant_branches pvb
    JOIN product_variants pv ON pv.id = pvb.variant_id
    WHERE pv.product_id = ?
  `, [productId]);

  const map = {};
  for (const row of rows) {
    if (!map[row.branch_id]) map[row.branch_id] = {};
    map[row.branch_id][row.variant_id] = row.price;
  }
  return map;
}

export function getProductBranchSettings(productId) {
  const branches = getBranches(false);
  const rows = queryAll(
    'SELECT branch_id, visible, price FROM product_branches WHERE product_id = ?',
    [productId],
  );
  const byBranch = Object.fromEntries(rows.map((row) => [row.branch_id, row]));
  const variants = queryAll(
    `SELECT id, name, price FROM product_variants
     WHERE product_id = ? AND COALESCE(archived, 0) = 0
     ORDER BY sort_order, name`,
    [productId],
  );
  const variantPriceMap = getVariantBranchPriceMap(productId);

  return branches.map((branch) => {
    const row = byBranch[branch.id];
    return {
      branch_id: branch.id,
      branch_name: branch.name,
      branch_active: !!branch.active,
      visible: row ? !!row.visible : false,
      price: row?.price ?? null,
      variants: variants.map((variant) => ({
        variant_id: variant.id,
        name: variant.name,
        base_price: variant.price,
        price: variantPriceMap[branch.id]?.[variant.id] ?? null,
      })),
    };
  });
}

export function setBranchProductPrice(productId, branchId, price) {
  upsertProductBranch(productId, branchId, { visible: true, price });
}

export function getVariantEffectivePrice(variantId, branchId, fallbackPrice = 0) {
  const row = queryOne(
    'SELECT price FROM product_variant_branches WHERE variant_id = ? AND branch_id = ?',
    [variantId, branchId],
  );
  if (row?.price != null) return row.price;
  return fallbackPrice;
}
