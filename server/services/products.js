import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { adjustBranchStock, getBranchStock, DEFAULT_BRANCH_ID } from '../branches.js';
import { getDefaultDepartmentId, syncBranchStockFromDepartments } from '../departments.js';
import {
  deleteVariantDepartmentStock,
  getVariantBranchStock,
  receiveDepartmentStock,
  setDepartmentStock,
  syncVariantCatalogStock,
} from '../inventoryCost.js';
import { deleteAllProductImages, deleteVariantImages } from '../productImages.js';
import {
  normalizeProductKind,
  parseProductKindFilter,
  productKindLabel,
  PRODUCT_KIND_GOODS,
} from '../productKinds.js';
import {
  ensureProductBranchOnCreate,
  getProductBranchSettings,
  getVariantEffectivePrice,
  saveProductBranchSettings,
  setBranchProductPrice,
} from '../productBranches.js';
import { parsePagination, paginateList } from '../pagination.js';
import { sortProductList } from '../productSort.js';

const { queryAll, queryOne, run } = db;

function buildProductsOrderBy(filters = {}) {
  const sortBy = String(filters.sort_by || '').trim();
  if (sortBy) {
    return 'p.name ASC';
  }
  return 'COALESCE(ppc.sort_order, pc.sort_order, 999), ppc.name, pc.parent_id IS NOT NULL, pc.sort_order, pc.name, p.name';
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

function isProductUsed(productId) {
  if (queryOne('SELECT 1 as ok FROM document_items WHERE product_id = ? LIMIT 1', [productId])) {
    return true;
  }
  if (queryOne('SELECT 1 as ok FROM calculation_items WHERE product_id = ? LIMIT 1', [productId])) {
    return true;
  }
  if (queryOne('SELECT 1 as ok FROM calculation_sources WHERE product_id = ? LIMIT 1', [productId])) {
    return true;
  }
  return false;
}

export function getProducts(filters = {}) {
  const branchId = filters.branch_id || DEFAULT_BRANCH_ID;
  const departmentId = filters.department_id || null;
  const archivedOnly = filters.archived === '1' || filters.archived === 1 ? 1 : 0;
  const adminList = filters.admin_list === '1' || filters.admin_list === 1 || filters.admin_list === true;

  let stockSelect;
  let stockJoin;
  let shopVisibleSelect = '';
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
    ), COALESCE(pb.price, p.price)) as avg_cost`;
    stockJoin = `INNER JOIN product_branches pb ON pb.product_id = p.id AND pb.branch_id = ? AND pb.visible = 1`;
    params = [departmentId, departmentId, branchId];
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
    ), COALESCE(pb.price, p.price)) as avg_cost`;
    if (adminList) {
      stockJoin = `LEFT JOIN product_branches pb ON pb.product_id = p.id AND pb.branch_id = ?
        LEFT JOIN product_branch_stock pbs ON pbs.product_id = p.id AND pbs.branch_id = ?`;
      shopVisibleSelect = ', COALESCE(pb.visible, 0) as shop_visible';
    } else {
      stockJoin = `INNER JOIN product_branches pb ON pb.product_id = p.id AND pb.branch_id = ? AND pb.visible = 1
        LEFT JOIN product_branch_stock pbs ON pbs.product_id = p.id AND pbs.branch_id = ?`;
    }
    params = [branchId, branchId, branchId, branchId];
  }

  let products = queryAll(`
    SELECT p.*,
           p.price as base_price,
           COALESCE(pb.price, p.price) as price,
           ${stockSelect}${shopVisibleSelect},
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
    WHERE COALESCE(p.archived, 0) = ${archivedOnly}
    ORDER BY ${buildProductsOrderBy(filters)}
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

  if (filters.category_id === '__no_category__') {
    products = products.filter((p) => !p.category_id || p.category_id === 'other');
  } else if (filters.category_id) {
    products = products.filter((p) => p.category_id === filters.category_id);
  }

  let result = products.map((p) => enrichProduct(p, branchId, departmentId, lastMap));

  if (filters.supplier_id === '__no_supplier__') {
    result = result.filter((p) => !p.suppliers?.length);
  } else if (filters.supplier_id) {
    result = result.filter((p) =>
      p.suppliers.some((s) => s.id === filters.supplier_id)
    );
  }

  const kindFilter = parseProductKindFilter(filters.product_kind);
  if (kindFilter) {
    result = result.filter((p) => kindFilter.includes(normalizeProductKind(p.product_kind)));
  }

  if (filters.sort_by) {
    result = sortProductList(result, filters.sort_by, filters.sort_dir);
  }

  const pagination = parsePagination(filters);
  if (!pagination) return result;
  return paginateList(result, pagination);
}

export function getProductKindCounts(filters = {}) {
  const archivedOnly = filters.archived === '1' || filters.archived === 1 ? 1 : 0;
  const rows = queryAll(`
    SELECT COALESCE(NULLIF(product_kind, ''), 'goods') as kind, COUNT(*) as count
    FROM products
    WHERE COALESCE(archived, 0) = ?
    GROUP BY kind
  `, [archivedOnly]);

  const counts = { all: 0 };
  for (const row of rows) {
    const kind = normalizeProductKind(row.kind);
    counts[kind] = row.count;
    counts.all += row.count;
  }
  return counts;
}

export function getProductCategories() {
  return queryAll(`
    SELECT pc.*,
           parent.name as parent_name,
           COUNT(DISTINCT p.id) as product_count,
           (SELECT COUNT(*) FROM product_categories ch WHERE ch.parent_id = pc.id) as subcategory_count
    FROM product_categories pc
    LEFT JOIN products p ON p.category_id = pc.id AND COALESCE(p.archived, 0) = 0
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
    product_kind: normalizeProductKind(data.product_kind),
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
  const variants = queryAll(
    'SELECT id FROM product_variants WHERE product_id = ? AND COALESCE(archived, 0) = 0',
    [productId],
  );
  let total = 0;
  for (const variant of variants) {
    total += getVariantBranchStock(variant.id, branchId);
    syncVariantCatalogStock(variant.id, branchId);
  }
  const current = getBranchStock(branchId, productId);
  adjustBranchStock(branchId, productId, total - current);
}

function getProductVariants(productId, departmentId = null, branchId = DEFAULT_BRANCH_ID, lastMap = null) {
  const variants = queryAll(`
    SELECT id, product_id, name, price, stock, sort_order
    FROM product_variants
    WHERE product_id = ? AND COALESCE(archived, 0) = 0
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
      base_price: variant.price,
      price: getVariantEffectivePrice(variant.id, branchId, variant.price),
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
  const existingRows = queryAll('SELECT id, archived FROM product_variants WHERE product_id = ?', [productId]);
  const existingIds = existingRows.map((r) => r.id);
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
      const archived = existingRows.find((r) => r.id === oldId)?.archived;
      if (archived) continue;
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
  if (!product) {
    throw new Error('Товар не найден');
  }
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
    product_kind: normalizeProductKind(rest.product_kind),
    product_kind_label: productKindLabel(rest.product_kind),
    has_variants: hasVariants,
    variants,
    is_used: isProductUsed(product.id),
    archived: !!rest.archived,
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

function fetchProductRow(id, branchId) {
  return queryOne(`
    SELECT p.*,
           p.price as base_price,
           COALESCE(pb.price, p.price) as price,
           COALESCE(pbs.stock, 0) as stock,
           pc.name as category_name, pc.parent_id as category_parent_id,
           ppc.name as parent_category_name,
           COALESCE(ppc.sort_order, pc.sort_order, 999) as category_sort,
           COALESCE(pc.sort_order, 999) as subcategory_sort,
           pi.file_name as primary_file_name,
           pi.media_type as primary_media_type,
           (SELECT COUNT(*) FROM product_images WHERE product_id = p.id AND media_type = 'photo') as photo_count,
           (SELECT COUNT(*) FROM product_images WHERE product_id = p.id AND media_type = 'gif') as gif_count
    FROM products p
    LEFT JOIN product_branches pb ON pb.product_id = p.id AND pb.branch_id = ?
    LEFT JOIN product_branch_stock pbs ON pbs.product_id = p.id AND pbs.branch_id = ?
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
    WHERE p.id = ?
  `, [branchId, branchId, id]);
}

export { getProductBranchSettings };

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
    INSERT INTO products (id, name, sku, unit, price, stock, category_id, product_kind, barcode, net_weight, gross_weight, has_variants)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
  `, [
    id, payload.name, payload.sku, payload.unit, payload.price,
    payload.category_id, payload.product_kind, payload.barcode || null,
    payload.net_weight, payload.gross_weight,
    payload.has_variants,
  ]);

  const branchId = data.branch_id || DEFAULT_BRANCH_ID;
  ensureProductBranchOnCreate(id, branchId);
  if (Array.isArray(data.branch_settings) && data.branch_settings.length) {
    saveProductBranchSettings(id, data.branch_settings);
  }

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
  return enrichProduct(fetchProductRow(id, branchId), branchId);
}

export function updateProduct(id, data, branchId = DEFAULT_BRANCH_ID, options = {}) {
  const payload = normalizeProductPayload(data);
  payload.barcode = assertUniqueBarcode(payload.barcode, id);

  if (!options.isAdmin && !payload.has_variants) {
    setBranchProductPrice(id, branchId, payload.price);
    const base = queryOne('SELECT price FROM products WHERE id = ?', [id]);
    payload.price = base?.price ?? payload.price;
  }

  run(`
    UPDATE products
    SET name=?, sku=?, unit=?, price=?, category_id=?, product_kind=?, barcode=?, net_weight=?, gross_weight=?,
        has_variants=?, updated_at=datetime('now')
    WHERE id=?
  `, [
    payload.name, payload.sku, payload.unit, payload.price,
    payload.category_id, payload.product_kind, payload.barcode || null,
    payload.net_weight, payload.gross_weight,
    payload.has_variants, id,
  ]);
  if (data.supplier_ids !== undefined) {
    setProductSuppliers(id, data.supplier_ids, branchId);
  }
  if (data.variants !== undefined || data.has_variants !== undefined) {
    saveProductVariants(id, !!payload.has_variants, data.variants || [], branchId);
  }
  if (options.isAdmin && Array.isArray(data.branch_settings)) {
    saveProductBranchSettings(id, data.branch_settings);
  }
  return enrichProduct(fetchProductRow(id, branchId), branchId);
}

export function getArchivedProductVariants(productId, branchId = DEFAULT_BRANCH_ID) {
  const variants = queryAll(`
    SELECT id, product_id, name, price, stock, sort_order
    FROM product_variants
    WHERE product_id = ? AND COALESCE(archived, 0) = 1
    ORDER BY sort_order, name
  `, [productId]);

  return variants.map((variant) => ({
    ...variant,
    base_price: variant.price,
    price: getVariantEffectivePrice(variant.id, branchId, variant.price),
  }));
}

export function archiveProductVariant(productId, variantId, branchId = DEFAULT_BRANCH_ID) {
  const row = queryOne(
    'SELECT id FROM product_variants WHERE id = ? AND product_id = ? AND COALESCE(archived, 0) = 0',
    [variantId, productId],
  );
  if (!row) throw new Error('Вариант не найден');

  const activeCount = queryOne(
    'SELECT COUNT(*) as c FROM product_variants WHERE product_id = ? AND COALESCE(archived, 0) = 0',
    [productId],
  ).c;
  if (activeCount <= 1) throw new Error('Нельзя архивировать последний вариант товара');

  run('UPDATE product_variants SET archived = 1 WHERE id = ?', [variantId]);

  const remaining = queryAll(
    'SELECT price FROM product_variants WHERE product_id = ? AND COALESCE(archived, 0) = 0',
    [productId],
  );
  if (remaining.length) {
    const minPrice = Math.min(...remaining.map((v) => v.price));
    run('UPDATE products SET price = ? WHERE id = ?', [minPrice, productId]);
  }

  syncProductStockFromVariants(productId, branchId);
  return enrichProduct(fetchProductRow(productId, branchId), branchId);
}

export function restoreProductVariant(productId, variantId, branchId = DEFAULT_BRANCH_ID) {
  const row = queryOne(
    'SELECT id FROM product_variants WHERE id = ? AND product_id = ? AND COALESCE(archived, 0) = 1',
    [variantId, productId],
  );
  if (!row) throw new Error('Вариант не найден в архиве');

  const product = queryOne('SELECT id FROM products WHERE id = ? AND COALESCE(archived, 0) = 0', [productId]);
  if (!product) throw new Error('Сначала верните товар из архива');

  run('UPDATE product_variants SET archived = 0 WHERE id = ?', [variantId]);

  const remaining = queryAll(
    'SELECT price FROM product_variants WHERE product_id = ? AND COALESCE(archived, 0) = 0',
    [productId],
  );
  if (remaining.length) {
    const minPrice = Math.min(...remaining.map((v) => v.price));
    run('UPDATE products SET price = ? WHERE id = ?', [minPrice, productId]);
  }

  syncProductStockFromVariants(productId, branchId);
  return enrichProduct(fetchProductRow(productId, branchId), branchId);
}

export function archiveProduct(id) {
  const product = queryOne('SELECT id FROM products WHERE id = ? AND COALESCE(archived, 0) = 0', [id]);
  if (!product) throw new Error('Товар не найден');
  run("UPDATE products SET archived = 1, updated_at = datetime('now') WHERE id = ?", [id]);
  return { ok: true, id };
}

export function restoreProduct(id, branchId = DEFAULT_BRANCH_ID) {
  const product = queryOne('SELECT id FROM products WHERE id = ? AND COALESCE(archived, 0) = 1', [id]);
  if (!product) throw new Error('Товар не найден в архиве');
  run("UPDATE products SET archived = 0, updated_at = datetime('now') WHERE id = ?", [id]);
  return enrichProduct(fetchProductRow(id, branchId), branchId);
}

export function deleteProduct(id) {
  if (isProductUsed(id)) {
    throw new Error('Товар использовался в операциях. Его можно только отправить в архив.');
  }
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