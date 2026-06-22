import { formatMoney } from '../api';

export function encodeProductPick(productId, variantId = null) {
  if (!productId) return '';
  if (variantId) return `v:${variantId}`;
  return `p:${productId}`;
}

export function decodeProductPick(value) {
  if (!value) return { productId: '', variantId: null };
  if (value.startsWith('v:')) return { productId: '', variantId: value.slice(2) };
  if (value.startsWith('p:')) return { productId: value.slice(2), variantId: null };
  return { productId: value, variantId: null };
}

export function findProductVariant(products, productId, variantId = null) {
  const product = products.find((p) => p.id === productId);
  if (!product) return { product: null, variant: null };
  if (!variantId) return { product, variant: null };
  const variant = (product.variants || []).find((v) => v.id === variantId) || null;
  return { product, variant };
}

export function resolvePickFromProducts(products, value) {
  const decoded = decodeProductPick(value);
  if (decoded.variantId) {
    for (const product of products) {
      const variant = (product.variants || []).find((v) => v.id === decoded.variantId);
      if (variant) return { product, variant, productId: product.id, variantId: variant.id };
    }
    return { product: null, variant: null, productId: '', variantId: null };
  }
  const product = products.find((p) => p.id === decoded.productId);
  return { product: product || null, variant: null, productId: product?.id || '', variantId: null };
}

export function getVariantPrimaryImage(variant) {
  const photos = (variant?.images || []).filter((i) => i.media_type === 'photo');
  return photos.find((i) => i.is_primary) || photos[0] || null;
}

export function getVariantDisplayName(product, variant) {
  return `${product.name} — ${variant.name}`;
}

export function getPickDisplayName(product, variant = null) {
  if (!product) return '';
  if (variant) return getVariantDisplayName(product, variant);
  return product.name;
}

export function getPickStock(product, variant = null) {
  if (variant) return variant.stock ?? 0;
  return product?.stock ?? 0;
}

export function getPickPrice(product, variant = null) {
  if (variant) {
    if (variant.last_price != null && variant.last_price !== '') return variant.last_price;
    if (variant.avg_cost != null && variant.avg_cost > 0) return variant.avg_cost;
    return variant.price ?? 0;
  }
  if (product?.last_price != null && product.last_price !== '') return product.last_price;
  if (product?.avg_cost != null && product.avg_cost > 0) return product.avg_cost;
  if (product?.has_variants && product.variant_price_min != null) {
    return product.variant_price_min;
  }
  return product?.price ?? 0;
}

export function buildProductPickOptions(products) {
  const options = [];
  for (const product of products) {
    if (product.has_variants && product.variants?.length) {
      for (const variant of product.variants) {
        options.push({
          key: encodeProductPick(product.id, variant.id),
          product,
          variant,
          label: getVariantDisplayName(product, variant),
          indent: 1,
        });
      }
      continue;
    }
    options.push({
      key: encodeProductPick(product.id),
      product,
      variant: null,
      label: product.name,
      indent: 0,
    });
  }
  return options;
}

export function buildProductListRows(products) {
  const rows = [];
  for (const product of products) {
    rows.push({ kind: 'product', product, variant: null, rowKey: product.id });
    if (product.has_variants && product.variants?.length) {
      for (const variant of product.variants) {
        rows.push({
          kind: 'variant',
          product,
          variant,
          rowKey: `${product.id}:${variant.id}`,
        });
      }
    }
  }
  return rows;
}

export function productListRowSearchHaystack(row) {
  const { product, variant, kind } = row;
  if (kind === 'variant' && variant) {
    return [
      getVariantDisplayName(product, variant),
      variant.name,
      product.name,
      variant.barcode,
      product.barcode,
      product.sku,
    ].filter(Boolean).join(' ').toLowerCase();
  }
  return [
    product.name,
    product.barcode,
    product.sku,
  ].filter(Boolean).join(' ').toLowerCase();
}

export function productListRowMatchesSearch(row, search) {
  const q = (search || '').trim().toLowerCase();
  if (!q) return true;
  return productListRowSearchHaystack(row).includes(q);
}

/** При поиске оставляет только совпадающие строки; для товаров с вариантами — только варианты */
export function filterProductListRowsBySearch(rows, search) {
  const q = (search || '').trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => {
    if (row.kind === 'variant') {
      return productListRowMatchesSearch(row, q);
    }
    if (row.product.has_variants) return false;
    return productListRowMatchesSearch(row, q);
  });
}

/** Нумерация: 1, 2, 2.1, 2.2 … для видимых строк списка */
export function buildProductRowNumbers(rows, startProductIndex = 0) {
  const numbers = new Map();
  const hasParentRows = rows.some((row) => row.kind === 'product');

  if (!hasParentRows) {
    rows.forEach((row, idx) => {
      numbers.set(row.rowKey, String(startProductIndex + idx + 1));
    });
    return numbers;
  }

  let productIndex = startProductIndex;
  const parentNumByProductId = new Map();
  const variantCountByProduct = new Map();

  for (const row of rows) {
    if (row.kind === 'product') {
      productIndex += 1;
      parentNumByProductId.set(row.product.id, productIndex);
      variantCountByProduct.set(row.product.id, 0);
      numbers.set(row.rowKey, String(productIndex));
    } else {
      const parentNum = parentNumByProductId.get(row.product.id);
      const variantIdx = (variantCountByProduct.get(row.product.id) || 0) + 1;
      variantCountByProduct.set(row.product.id, variantIdx);
      numbers.set(row.rowKey, `${parentNum}.${variantIdx}`);
    }
  }

  return numbers;
}

export function productPickMeta(product, variant = null) {
  const parts = [];
  const stock = getPickStock(product, variant);
  if (stock != null) parts.push(`ост: ${stock} ${product?.unit || 'шт'}`);
  const price = getPickPrice(product, variant);
  if (price != null) parts.push(formatMoney(price));
  if (!variant && product?.category_name) parts.push(product.category_name);
  return parts.join(' · ');
}

export function filterProductPickOptions(options, search) {
  const q = search.trim().toLowerCase();
  if (!q) return options;
  return options.filter((option) => {
    const hay = [
      option.label,
      option.product?.sku,
      option.product?.barcode,
      option.product?.category_name,
      option.product?.parent_category_name,
      option.variant?.name,
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  });
}

function pickSearchText(product, variant = null) {
  return [
    product?.name,
    variant?.name,
    variant ? `${product?.name} ${variant.name}` : null,
    product?.sku,
    product?.barcode,
    product?.category_name,
    product?.parent_category_name,
  ].filter(Boolean).join(' ').toLowerCase();
}

export function buildProductPickGroups(products) {
  const groups = [];
  for (const product of products) {
    if (product.has_variants && product.variants?.length) {
      groups.push({
        id: product.id,
        product,
        options: product.variants.map((variant) => ({
          key: encodeProductPick(product.id, variant.id),
          product,
          variant,
          label: variant.name,
          searchText: pickSearchText(product, variant),
        })),
      });
      continue;
    }
    groups.push({
      id: product.id,
      product,
      options: [{
        key: encodeProductPick(product.id),
        product,
        variant: null,
        label: product.name,
        searchText: pickSearchText(product),
      }],
    });
  }
  return groups;
}

export function filterProductPickGroups(groups, search) {
  const q = search.trim().toLowerCase();
  if (!q) return groups;

  return groups
    .map((group) => {
      const parentHay = [
        group.product.name,
        group.product.sku,
        group.product.barcode,
        group.product.category_name,
        group.product.parent_category_name,
      ].filter(Boolean).join(' ').toLowerCase();
      const parentMatch = parentHay.includes(q);
      const options = parentMatch
        ? group.options
        : group.options.filter((option) => option.searchText.includes(q));
      if (!options.length) return null;
      return { ...group, options };
    })
    .filter(Boolean);
}

export function flattenProductPickGroups(groups) {
  return groups.flatMap((group) => group.options);
}

export function getPickMetaParts(product, variant = null) {
  return {
    stock: getPickStock(product, variant),
    unit: product?.unit || 'шт',
    price: getPickPrice(product, variant),
  };
}
