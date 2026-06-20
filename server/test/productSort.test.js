import test from 'node:test';
import assert from 'node:assert/strict';
import { compareProductsForSort, sortProductList } from '../productSort.js';

test('sortProductList sorts by name ascending and descending', () => {
  const items = [
    { name: 'Банан', product_kind: 'goods' },
    { name: 'Апельсин', product_kind: 'raw' },
    { name: 'Яблоко', product_kind: 'goods' },
  ];

  const asc = sortProductList(items, 'name', 'asc').map((item) => item.name);
  assert.deepEqual(asc, ['Апельсин', 'Банан', 'Яблоко']);

  const desc = sortProductList(items, 'name', 'desc').map((item) => item.name);
  assert.deepEqual(desc, ['Яблоко', 'Банан', 'Апельсин']);
});

test('compareProductsForSort uses variant min price', () => {
  const cheaper = { name: 'A', has_variants: true, variant_price_min: 100, price: 500 };
  const expensive = { name: 'B', has_variants: false, price: 200 };
  assert.ok(compareProductsForSort(cheaper, expensive, 'price', 'asc') < 0);
});
