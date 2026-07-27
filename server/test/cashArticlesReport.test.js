import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir;

before(() => {
  testDir = mkdtempSync(join(tmpdir(), 'warehouse-ca-report-'));
  process.env.DATA_DIR = testDir;
  process.env.DISABLE_DEMO_SEED = 'true';
  process.env.NODE_ENV = 'test';
});

after(() => {
  if (testDir) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

test('cash articles report is isolated per branch', async () => {
  const { default: db, initDb } = await import('../db.js');
  const { createBranch } = await import('../branches.js');
  const { getCashArticlesReport, getPnLReport } = await import('../services/reports.js');
  const { cashArticleId } = await import('../cashArticleDefaults.js');
  const { v4: uuidv4 } = await import('uuid');

  await initDb();
  createBranch({ id: 'branch-b', name: 'Филиал B' });

  const mainArticle = cashArticleId('main', 'exp_other');
  const branchArticle = cashArticleId('branch-b', 'exp_other');
  const date = '2026-07-15';

  db.run(
    `INSERT INTO payments (id, number, type, amount, date, branch_id, article_id)
     VALUES (?, 'ca-r1', 'other_expense', 10000, ?, 'main', ?)`,
    [uuidv4(), date, mainArticle],
  );
  db.run(
    `INSERT INTO payments (id, number, type, amount, date, branch_id, article_id)
     VALUES (?, 'ca-r2', 'other_expense', 77777, ?, 'branch-b', ?)`,
    [uuidv4(), date, branchArticle],
  );
  // Legacy NULL branch_id — только для main
  db.run(
    `INSERT INTO payments (id, number, type, amount, date, branch_id, article_id)
     VALUES (?, 'ca-r3', 'other_income', 500, ?, NULL, ?)`,
    [uuidv4(), date, cashArticleId('main', 'inc_other')],
  );

  const mainReport = getCashArticlesReport('main', date, date);
  const branchReport = getCashArticlesReport('branch-b', date, date);

  assert.equal(mainReport.branch_id, 'main');
  assert.equal(branchReport.branch_id, 'branch-b');

  assert.equal(mainReport.expense.total, 10000);
  assert.equal(branchReport.expense.total, 77777);
  assert.equal(mainReport.income.total, 500);
  assert.equal(branchReport.income.total, 0);

  // Чужая статья в JOIN не должна подтянуть имя другого филиала
  db.run(
    `INSERT INTO payments (id, number, type, amount, date, branch_id, article_id)
     VALUES (?, 'ca-r4', 'other_expense', 111, ?, 'main', ?)`,
    [uuidv4(), date, branchArticle],
  );
  const mainAfterCross = getCashArticlesReport('main', date, date);
  const crossRow = mainAfterCross.expense.items.find((i) => i.amount === 111 || (i.name === 'Без статьи' && i.ops_count >= 1));
  assert.ok(
    mainAfterCross.expense.items.some((i) => i.name === 'Без статьи' && i.amount >= 111),
    'платёж с article_id чужого филиала должен попасть в «Без статьи»',
  );
  assert.ok(crossRow || mainAfterCross.expense.total === 10111);

  const mainPnl = getPnLReport('main', date, date);
  const branchPnl = getPnLReport('branch-b', date, date);
  assert.equal(mainPnl.operating_expenses.total, 10111);
  assert.equal(branchPnl.operating_expenses.total, 77777);
  assert.equal(mainPnl.other_income.total, 500);
  assert.equal(branchPnl.other_income.total, 0);
});
