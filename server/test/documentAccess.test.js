import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterDocumentsForUser,
  assertDocumentBranchAccess,
  assertDocumentMutableInBranch,
  assertDocumentTypeAccess,
  assertCounterpartyBranchAccess,
} from '../documentAccess.js';

test('filterDocumentsForUser limits types without full access', () => {
  const docs = [
    { id: '1', type: 'prihod' },
    { id: '2', type: 'rashod' },
    { id: '3', type: 'razdelka' },
  ];
  const filtered = filterDocumentsForUser(docs, 'role_without_docs');
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

test('assertDocumentBranchAccess blocks foreign branch for everyone including admin', () => {
  const user = { role: 'warehouse', branch_id: 'branch-a' };
  const doc = { branch_id: 'branch-b' };
  assert.throws(
    () => assertDocumentBranchAccess(user, doc, 'branch-a'),
    /филиала/,
  );
  assert.throws(
    () => assertDocumentBranchAccess({ role: 'admin', branch_id: null }, doc, 'branch-a'),
    /филиала/,
  );
});

test('assertDocumentBranchAccess allows transfer visibility on both ends', () => {
  const user = { role: 'warehouse', branch_id: 'branch-a' };
  const doc = {
    branch_id: 'branch-a',
    from_branch_id: 'branch-a',
    to_branch_id: 'branch-b',
  };
  assert.doesNotThrow(() => assertDocumentBranchAccess(user, doc, 'branch-a'));
  assert.doesNotThrow(() => assertDocumentBranchAccess(user, doc, 'branch-b'));
});

test('assertDocumentMutableInBranch allows only transfer sender', () => {
  const doc = {
    type: 'peremeshchenie',
    branch_id: 'branch-a',
    from_branch_id: 'branch-a',
    to_branch_id: 'branch-b',
  };
  assert.doesNotThrow(() => assertDocumentMutableInBranch(doc, 'branch-a'));
  assert.throws(() => assertDocumentMutableInBranch(doc, 'branch-b'), /отправитель/);
});

test('assertDocumentTypeAccess validates role permissions', () => {
  assert.throws(
    () => assertDocumentTypeAccess('cashier', 'prihod'),
    /прав/,
  );
  assert.doesNotThrow(() => assertDocumentTypeAccess('warehouse', 'prihod'));
});

test('assertCounterpartyBranchAccess rejects missing or foreign branch', () => {
  const user = { role: 'warehouse', branch_id: 'main' };
  assert.throws(
    () => assertCounterpartyBranchAccess(user, { branch_id: 'other' }, 'main'),
    /контрагент/,
  );
  assert.throws(
    () => assertCounterpartyBranchAccess(user, { branch_id: null }, 'main'),
    /контрагент/,
  );
  assert.throws(
    () => assertCounterpartyBranchAccess({ role: 'admin' }, { branch_id: 'other' }, 'main'),
    /контрагент/,
  );
});
