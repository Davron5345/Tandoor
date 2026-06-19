import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterDocumentsForUser,
  assertDocumentBranchAccess,
  assertDocumentTypeAccess,
  assertCounterpartyBranchAccess,
} from '../documentAccess.js';

test('filterDocumentsForUser limits types without full access', () => {
  const docs = [
    { id: '1', type: 'prihod' },
    { id: '2', type: 'rashod' },
    { id: '3', type: 'razdelka' },
  ];
  const filtered = filterDocumentsForUser(docs, 'cashier');
  assert.equal(filtered.length, 0);
});

test('warehouse role sees allowed document types', () => {
  const docs = [
    { id: '1', type: 'prihod' },
    { id: '2', type: 'rashod' },
  ];
  const filtered = filterDocumentsForUser(docs, 'warehouse');
  assert.equal(filtered.length, 2);
});

test('assertDocumentBranchAccess blocks foreign branch', () => {
  const user = { role: 'warehouse', branch_id: 'branch-a' };
  const doc = { branch_id: 'branch-b' };
  assert.throws(
    () => assertDocumentBranchAccess(user, doc),
    /филиала/,
  );
});

test('admin bypasses branch access checks', () => {
  const user = { role: 'admin', branch_id: null };
  const doc = { branch_id: 'branch-b' };
  assert.doesNotThrow(() => assertDocumentBranchAccess(user, doc));
});

test('assertDocumentTypeAccess validates role permissions', () => {
  assert.throws(
    () => assertDocumentTypeAccess('cashier', 'prihod'),
    /прав/,
  );
  assert.doesNotThrow(() => assertDocumentTypeAccess('warehouse', 'prihod'));
});

test('assertCounterpartyBranchAccess validates counterparty branch', () => {
  const user = { role: 'warehouse', branch_id: 'main' };
  assert.throws(
    () => assertCounterpartyBranchAccess(user, { branch_id: 'other' }, 'main'),
    /контрагент/,
  );
});
