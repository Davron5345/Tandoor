import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir;

before(() => {
  testDir = mkdtempSync(join(tmpdir(), 'warehouse-branch-iso-'));
  process.env.DATA_DIR = testDir;
  process.env.DISABLE_DEMO_SEED = 'true';
  process.env.NODE_ENV = 'test';
});

after(() => {
  if (testDir) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

test('cannot create confirmed transfer draining another branch', async () => {
  const { initDb } = await import('../db.js');
  const { createBranch } = await import('../branches.js');
  const { createDocument } = await import('../services/documents.js');
  const { getDefaultDepartmentId } = await import('../departments.js');
  const { v4: uuidv4 } = await import('uuid');
  const db = (await import('../db.js')).default;

  await initDb();
  createBranch({ id: 'branch-b', name: 'Филиал B' });

  const productId = uuidv4();
  db.run(
    `INSERT INTO products (id, name, unit, price) VALUES (?, 'Товар', 'кг', 100)`,
    [productId],
  );
  const mainDept = getDefaultDepartmentId('main');
  assert.ok(mainDept);

  assert.throws(
    () => createDocument({
      type: 'peremeshchenie',
      date: '2026-07-27',
      from_branch_id: 'main',
      to_branch_id: 'branch-b',
      from_department_id: mainDept,
      status: 'confirmed',
      items: [{ product_id: productId, quantity: 5, price: 0 }],
    }, null, 'branch-b'),
    /своего филиала/,
  );

  assert.throws(
    () => createDocument({
      type: 'prihod',
      date: '2026-07-27',
      branch_id: 'main',
      to_department_id: mainDept,
      status: 'draft',
      items: [{ product_id: productId, quantity: 1, price: 10 }],
    }, null, 'branch-b'),
    /филиалу/,
  );
});

test('getDocument returns null for foreign branch', async () => {
  const { initDb } = await import('../db.js');
  const { createBranch } = await import('../branches.js');
  const { createDocument, getDocument } = await import('../services/documents.js');
  const { getDefaultDepartmentId } = await import('../departments.js');
  const { v4: uuidv4 } = await import('uuid');
  const db = (await import('../db.js')).default;

  await initDb();
  createBranch({ id: 'branch-c', name: 'Филиал C' });
  const productId = uuidv4();
  db.run(
    `INSERT INTO products (id, name, unit, price) VALUES (?, 'Товар2', 'кг', 100)`,
    [productId],
  );
  const dept = getDefaultDepartmentId('main');
  const doc = createDocument({
    type: 'prihod',
    date: '2026-07-27',
    to_department_id: dept,
    status: 'draft',
    items: [{ product_id: productId, quantity: 1, price: 10 }],
  }, null, 'main');

  assert.ok(getDocument(doc.id, 'main'));
  assert.equal(getDocument(doc.id, 'branch-c'), null);
});
