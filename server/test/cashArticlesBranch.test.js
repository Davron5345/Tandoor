import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir;

before(() => {
  testDir = mkdtempSync(join(tmpdir(), 'warehouse-ca-branch-'));
  process.env.DATA_DIR = testDir;
  process.env.DISABLE_DEMO_SEED = 'true';
  process.env.NODE_ENV = 'test';
});

after(() => {
  if (testDir) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

test('cash articles are isolated per branch', async () => {
  const { initDb } = await import('../db.js');
  const { createBranch } = await import('../branches.js');
  const {
    getCashArticles,
    createCashArticle,
    assertCashArticleForPayment,
  } = await import('../cashArticles.js');
  const { PURCHASE_ARTICLE_CODE, cashArticleId } = await import('../cashArticleDefaults.js');

  await initDb();
  createBranch({ id: 'branch-b', name: 'Филиал B' });

  const mainArticles = getCashArticles(null, 'main');
  const branchArticles = getCashArticles(null, 'branch-b');
  assert.ok(mainArticles.length >= 8);
  assert.equal(branchArticles.length, mainArticles.length);

  const mainPurchase = mainArticles.find((a) => a.code === PURCHASE_ARTICLE_CODE);
  const branchPurchase = branchArticles.find((a) => a.code === PURCHASE_ARTICLE_CODE);
  assert.notEqual(mainPurchase.id, branchPurchase.id);
  assert.equal(mainPurchase.id, cashArticleId('main', PURCHASE_ARTICLE_CODE));
  assert.equal(branchPurchase.id, cashArticleId('branch-b', PURCHASE_ARTICLE_CODE));

  createCashArticle({ name: 'Только main', direction: 'income', sort_order: 99 }, 'main');
  assert.equal(getCashArticles('income', 'main').some((a) => a.name === 'Только main'), true);
  assert.equal(getCashArticles('income', 'branch-b').some((a) => a.name === 'Только main'), false);

  assert.throws(
    () => assertCashArticleForPayment(branchPurchase.id, 'supplier_payment', 'main'),
    /другому филиалу|не найдена/,
  );
});

test('migration remaps legacy article ids for non-main branch payments', async () => {
  const { default: db, initDb, reloadDb } = await import('../db.js');
  const { v4: uuidv4 } = await import('uuid');
  const { cashArticleId, PURCHASE_ARTICLE_CODE } = await import('../cashArticleDefaults.js');

  await initDb();
  db.run("DELETE FROM settings WHERE key = 'cash_articles_branch_v1'");
  db.run("INSERT OR IGNORE INTO branches (id, name, active) VALUES ('tnd', 'Tandoor', 1)");
  const paymentId = uuidv4();
  db.run(
    `INSERT INTO payments (id, number, type, amount, date, branch_id, article_id)
     VALUES (?, '99', 'supplier_payment', 1000, '2026-06-19', 'tnd', 'ca_exp_purchase')`,
    [paymentId],
  );

  await reloadDb();

  const payment = db.queryOne('SELECT article_id FROM payments WHERE id = ?', [paymentId]);
  assert.equal(payment.article_id, cashArticleId('tnd', PURCHASE_ARTICLE_CODE));
});
