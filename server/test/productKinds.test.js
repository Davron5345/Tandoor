import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeProductKind,
  parseProductKindFilter,
  productKindLabel,
  PRODUCT_KIND_RAW,
} from '../productKinds.js';

test('normalizeProductKind falls back to goods', () => {
  assert.equal(normalizeProductKind('raw'), PRODUCT_KIND_RAW);
  assert.equal(normalizeProductKind('unknown'), 'goods');
});

test('parseProductKindFilter parses comma list', () => {
  assert.deepEqual(parseProductKindFilter('raw,semi_finished'), ['raw', 'semi_finished']);
  assert.equal(parseProductKindFilter('bad'), null);
});

test('productKindLabel returns Russian label', () => {
  assert.equal(productKindLabel('dish'), 'Готовое блюдо');
});
