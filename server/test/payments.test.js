import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir;

before(() => {
  testDir = mkdtempSync(join(tmpdir(), 'warehouse-payments-'));
  process.env.DATA_DIR = testDir;
  process.env.DISABLE_DEMO_SEED = 'true';
  process.env.NODE_ENV = 'test';
});

after(() => {
  if (testDir) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

test('getPayments includes legacy NULL branch_id for main', async () => {
  const { default: db, initDb } = await import('../db.js');
  const { getPayments } = await import('../services/payments.js');
  const { v4: uuidv4 } = await import('uuid');

  await initDb();
  db.run(
    `INSERT INTO payments (id, number, type, amount, date, branch_id, article_id)
     VALUES (?, '1', 'other_income', 1000, '2026-06-19', NULL, 'ca_inc_other')`,
    [uuidv4()],
  );

  const mainPayments = getPayments('main');
  assert.equal(mainPayments.length, 1);

  const otherPayments = getPayments('other-branch');
  assert.equal(otherPayments.length, 0);
});

test('getCashShiftSummary carries closing balance to next day opening', async () => {
  const { default: db, initDb } = await import('../db.js');
  const { getCashShiftSummary } = await import('../services/payments.js');
  const { v4: uuidv4 } = await import('uuid');

  await initDb();
  db.run(
    `INSERT INTO payments (id, number, type, amount, date, branch_id, article_id)
     VALUES (?, '101', 'other_income', 500000, '2026-06-22', 'main', 'ca_inc_other')`,
    [uuidv4()],
  );
  db.run(
    `INSERT INTO payments (id, number, type, amount, date, branch_id, article_id)
     VALUES (?, '102', 'other_expense', 100000, '2026-06-22', 'main', 'ca_exp_other')`,
    [uuidv4()],
  );

  const day1 = getCashShiftSummary('main', '2026-06-22');
  assert.equal(day1.opening_balance, 1000);
  assert.equal(day1.income, 500000);
  assert.equal(day1.expense, 100000);
  assert.equal(day1.closing_balance, 401000);

  const day2 = getCashShiftSummary('main', '2026-06-23');
  assert.equal(day2.opening_balance, 401000);
  assert.equal(day2.closing_balance, 401000);
});
