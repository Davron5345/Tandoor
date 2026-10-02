import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir;

before(() => {
  testDir = mkdtempSync(join(tmpdir(), 'warehouse-recon-marks-'));
  process.env.DATA_DIR = testDir;
  process.env.DISABLE_DEMO_SEED = 'true';
  process.env.NODE_ENV = 'test';
});

after(() => {
  if (testDir) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

test('reconciliation marks: scope by firm/contract, branch isolation, delete rights', async () => {
  const { default: db, initDb } = await import('../db.js');
  const { createBranch } = await import('../branches.js');
  const {
    getReconciliationMarks,
    createReconciliationMark,
    deleteReconciliationMark,
  } = await import('../services/reconciliationMarks.js');

  await initDb();
  createBranch({ id: 'branch-b', name: 'Филиал B' });

  db.run(
    "INSERT INTO counterparties (id, name, type, branch_id) VALUES ('cp-main', 'Мурод', 'supplier', 'main')",
  );
  db.run(
    "INSERT INTO counterparties (id, name, type, branch_id) VALUES ('cp-b', 'Чужой', 'supplier', 'branch-b')",
  );

  const all = createReconciliationMark('main', {
    counterparty_id: 'cp-main',
    date: '2026-09-15',
    balance: 22570300.004,
    comment: 'Сверились по телефону',
  }, 'user-1');
  assert.equal(all.balance, 22570300);
  assert.equal(all.firm_id, null);

  createReconciliationMark('main', {
    counterparty_id: 'cp-main',
    firm_id: 'firm-1',
    date: '2026-09-20',
    balance: 100,
  }, 'user-1');

  const allScope = getReconciliationMarks('main', { counterparty_id: 'cp-main' });
  assert.equal(allScope.length, 1);
  assert.equal(allScope[0].comment, 'Сверились по телефону');

  const firmScope = getReconciliationMarks('main', { counterparty_id: 'cp-main', firm_id: 'firm-1' });
  assert.equal(firmScope.length, 1);
  assert.equal(firmScope[0].date, '2026-09-20');

  assert.throws(
    () => createReconciliationMark('main', { counterparty_id: 'cp-b', date: '2026-09-15', balance: 0 }, 'user-1'),
    /филиала/,
  );
  assert.throws(
    () => createReconciliationMark('main', { counterparty_id: 'cp-main', date: '15.09.2026', balance: 0 }, 'user-1'),
    /дату/,
  );
  assert.equal(getReconciliationMarks('branch-b', { counterparty_id: 'cp-main' }).length, 0);

  assert.throws(
    () => deleteReconciliationMark('main', all.id, { id: 'user-2', role: 'accountant' }),
    /администратор/,
  );
  assert.throws(
    () => deleteReconciliationMark('branch-b', all.id, { id: 'user-1', role: 'accountant' }),
    /не найдена/,
  );
  deleteReconciliationMark('main', all.id, { id: 'user-1', role: 'accountant' });
  assert.equal(getReconciliationMarks('main', { counterparty_id: 'cp-main' }).length, 0);
});
