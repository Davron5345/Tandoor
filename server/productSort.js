import { productKindLabel } from './productKinds.js';

function text(value) {
  return (value ?? '').toString().toLocaleLowerCase('ru');
}

function number(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

function productPriceValue(product) {
  if (product.has_variants && product.variant_price_min != null) {
    return number(product.variant_price_min);
  }
  return number(product.price);
}

export function compareProductsForSort(a, b, sortBy, sortDir = 'asc') {
  const dir = sortDir === 'desc' ? -1 : 1;

  switch (sortBy) {
    case 'product_kind': {
      const av = text(a.product_kind_label || productKindLabel(a.product_kind));
      const bv = text(b.product_kind_label || productKindLabel(b.product_kind));
      return dir * av.localeCompare(bv, 'ru');
    }
    case 'category_name':
      return dir * text(a.category_name).localeCompare(text(b.category_name), 'ru');
    case 'sku':
      return dir * text(a.sku).localeCompare(text(b.sku), 'ru');
    case 'unit':
      return dir * text(a.unit).localeCompare(text(b.unit), 'ru');
    case 'net_weight':
    case 'gross_weight': {
      const av = number(a[sortBy]);
      const bv = number(b[sortBy]);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return dir * (av - bv);
    }
    case 'price': {
      const av = productPriceValue(a);
      const bv = productPriceValue(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return dir * (av - bv);
    }
    case 'stock': {
      const av = number(a.stock);
      const bv = number(b.stock);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return dir * (av - bv);
    }
    case 'name':
    default:
      return dir * text(a.name).localeCompare(text(b.name), 'ru');
  }
}

const SORT_COLUMNS = new Set([
  'name',
  'product_kind',
  'category_name',
  'sku',
  'unit',
  'net_weight',
  'gross_weight',
  'price',
  'stock',
]);

export function sortProductList(items, sortBy, sortDir = 'asc') {
  const key = String(sortBy || '').trim();
  if (!SORT_COLUMNS.has(key)) return items;
  const direction = String(sortDir || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
  return [...items].sort((a, b) => compareProductsForSort(a, b, key, direction));
}
