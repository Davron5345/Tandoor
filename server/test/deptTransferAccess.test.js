import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterTransfersForDepartment,
  assertDocumentDepartmentAccess,
  assertDocumentMutableInBranch,
  applyDepartmentScopedTransferBody,
  isDepartmentScopedUser,
} from '../documentAccess.js';

test('isDepartmentScopedUser requires department_id', () => {
  assert.equal(isDepartmentScopedUser({ department_id: 'd1' }), true);
  assert.equal(isDepartmentScopedUser({}), false);
  assert.equal(isDepartmentScopedUser(null), false);
});

test('filterTransfersForDepartment keeps only involving transfers', () => {
  const user = { department_id: 'kitchen' };
  const docs = [
    { id: '1', type: 'peremeshchenie', from_department_id: 'kitchen', to_department_id: 'bar' },
    { id: '2', type: 'peremeshchenie', from_department_id: 'bar', to_department_id: 'kitchen' },
    { id: '3', type: 'peremeshchenie', from_department_id: 'wh', to_department_id: 'bar' },
    { id: '4', type: 'prihod', to_department_id: 'kitchen' },
  ];
  const filtered = filterTransfersForDepartment(docs, user);
  assert.deepEqual(filtered.map((d) => d.id), ['1', '2', '4']);
});

test('assertDocumentDepartmentAccess blocks foreign transfers', () => {
  const user = { department_id: 'kitchen' };
  assert.doesNotThrow(() => assertDocumentDepartmentAccess(user, {
    type: 'peremeshchenie',
    from_department_id: 'kitchen',
    to_department_id: 'bar',
  }));
  assert.throws(() => assertDocumentDepartmentAccess(user, {
    type: 'peremeshchenie',
    from_department_id: 'wh',
    to_department_id: 'bar',
  }), /отдела/);
});

test('assertDocumentMutableInBranch blocks receiver department', () => {
  const doc = {
    type: 'peremeshchenie',
    branch_id: 'main',
    from_branch_id: 'main',
    to_branch_id: 'main',
    from_department_id: 'kitchen',
    to_department_id: 'bar',
  };
  assert.doesNotThrow(() => assertDocumentMutableInBranch(doc, 'main', { department_id: 'kitchen' }));
  assert.throws(
    () => assertDocumentMutableInBranch(doc, 'main', { department_id: 'bar' }),
    /отдел-отправитель/,
  );
});

test('applyDepartmentScopedTransferBody forces from department', () => {
  const user = { department_id: 'kitchen' };
  const next = applyDepartmentScopedTransferBody({
    type: 'peremeshchenie',
    from_department_id: 'wh',
    to_department_id: 'bar',
  }, user, 'main');
  assert.equal(next.from_department_id, 'kitchen');
  assert.equal(next.to_department_id, 'bar');
  assert.equal(next.from_branch_id, 'main');
  assert.equal(next.to_branch_id, 'main');
  assert.throws(() => applyDepartmentScopedTransferBody({
    type: 'peremeshchenie',
    to_department_id: 'kitchen',
  }, user, 'main'), /свой же отдел/);
  assert.deepEqual(
    applyDepartmentScopedTransferBody({ type: 'prihod' }, user, 'main'),
    { type: 'prihod' },
  );
});
