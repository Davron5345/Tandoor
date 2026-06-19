import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePagination,
  paginateList,
  stripPaginationParams,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} from '../pagination.js';

test('parsePagination returns null without page/limit', () => {
  assert.equal(parsePagination({}), null);
  assert.equal(parsePagination({ type: 'prihod' }), null);
});

test('parsePagination parses page and limit', () => {
  const p = parsePagination({ page: '2', limit: '25' });
  assert.deepEqual(p, { page: 2, limit: 25, offset: 25 });
});

test('parsePagination clamps invalid values', () => {
  const p = parsePagination({ page: '-1', limit: '9999' });
  assert.equal(p.page, 1);
  assert.equal(p.limit, MAX_LIMIT);
});

test('paginateList returns page metadata', () => {
  const items = Array.from({ length: 120 }, (_, i) => i + 1);
  const page = paginateList(items, { page: 2, limit: 50, offset: 50 });
  assert.equal(page.items.length, 50);
  assert.equal(page.items[0], 51);
  assert.equal(page.total, 120);
  assert.equal(page.page, 2);
  assert.equal(page.pages, 3);
});

test('stripPaginationParams removes paging keys', () => {
  assert.deepEqual(
    stripPaginationParams({ page: '1', limit: '10', type: 'prihod' }),
    { type: 'prihod' },
  );
});

test('paginateList uses default page when beyond range', () => {
  const page = paginateList([1, 2, 3], { page: 99, limit: DEFAULT_LIMIT, offset: 0 });
  assert.equal(page.page, 1);
  assert.deepEqual(page.items, [1, 2, 3]);
});
