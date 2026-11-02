import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildSearchMatcher } from '../searchText.js';

let testDir;
let svc;
let deptId;
let supplierJalil;
let supplierMurod;
let docJalil;
let docMurod;

before(async () => {
  testDir = mkdtempSync(join(tmpdir(), 'warehouse-doc-search-'));
  process.env.DATA_DIR = testDir;
  process.env.DISABLE_DEMO_SEED = 'true';
  process.env.NODE_ENV = 'test';
  process.env.TELEGRAM_ENABLED = 'false';

  const { default: db, initDb } = await import('../db.js');
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  svc = await import('../services.js');
  const { getDefaultDepartmentId } = await import('../departments.js');
  await initDb();
  initPermissions(db);
  seedDefaultUsers();
  deptId = getDefaultDepartmentId('main');

  supplierJalil = svc.createCounterparty({ name: 'Жалил ака', type: 'supplier' }, 'main');
  supplierMurod = svc.createCounterparty({ name: 'Murod', type: 'supplier' }, 'main');

  const son = svc.createProduct({
    name: 'Сон', sku: 'SON-1', unit: 'кг', price: 100, branch_id: 'main', keywords: 'Бедро, Окорок',
    supplier_ids: [supplierJalil.id],
  });
  const mol = svc.createProduct({
    name: 'Мол', sku: 'MOL-1', unit: 'кг', price: 100, branch_id: 'main', category_id: 'other',
    supplier_ids: [supplierMurod.id],
    has_variants: true, variants: [{ name: 'Суяк', price: 100 }, { name: 'Гушт', price: 200 }],
  });

  docJalil = svc.createDocument({
    type: 'prihod',
    date: '2026-10-01',
    to_department_id: deptId,
    counterparty_id: supplierJalil.id,
    comment: 'из Telegram · Нодирбек',
    items: [{ product_id: son.id, quantity: 10, price: 100 }],
    status: 'draft',
  }, 'test-user', 'main');
  docMurod = svc.createDocument({
    type: 'prihod',
    date: '2026-10-02',
    to_department_id: deptId,
    counterparty_id: supplierMurod.id,
    items: [{ product_id: mol.id, variant_id: mol.variants[1].id, quantity: 5, price: 200 }],
    status: 'draft',
  }, 'test-user', 'main');
});

after(() => {
  if (testDir) rmSync(testDir, { recursive: true, force: true });
});

function search(q, extra = {}) {
  return svc.getDocuments({ branch_id: 'main', type: 'prihod', q, ...extra });
}

test('matcher: layout, translit and multi-word queries', () => {
  const m = buildSearchMatcher('Qo\'zi');
  assert.equal(m('Қўзи гўшти'), true);
  assert.equal(m('Сон'), false);
  // русская раскладка вместо латиницы и наоборот
  assert.equal(buildSearchMatcher('Vehjl')('Мурод'), true);
  assert.equal(buildSearchMatcher('ьгкщв')('Murod'), true);
  // слова в любом порядке
  assert.equal(buildSearchMatcher('ака жалил')('Жалил ака'), true);
  assert.equal(buildSearchMatcher(''), null);
});

test('search by supplier name in any script', () => {
  for (const q of ['жалил', 'Jalil', 'ЖАЛИЛ АКА', ';fkbk']) {
    const rows = search(q);
    assert.deepEqual(rows.map((r) => r.id), [docJalil.id], `query «${q}»`);
    assert.deepEqual(rows[0].search_matches, []);
  }
  const murod = search('Мурод');
  assert.deepEqual(murod.map((r) => r.id), [docMurod.id]);
});

test('search by product name, variant and keywords returns matched labels', () => {
  const bySon = search('son');
  assert.deepEqual(bySon.map((r) => r.id), [docJalil.id]);
  assert.deepEqual(bySon[0].search_matches, ['Сон']);

  const byKeyword = search('окорок');
  assert.deepEqual(byKeyword.map((r) => r.id), [docJalil.id]);

  const byVariant = search('гушт');
  assert.deepEqual(byVariant.map((r) => r.id), [docMurod.id]);
  assert.deepEqual(byVariant[0].search_matches, ['Мол — Гушт']);

  assert.equal(search('суяк').length, 0, 'вариант без строк в документах не находится');
});

test('search by number and comment; combined with other filters', () => {
  const byNumber = search(String(docMurod.number));
  assert.ok(byNumber.some((r) => r.id === docMurod.id));

  const byComment = search('нодирбек');
  assert.deepEqual(byComment.map((r) => r.id), [docJalil.id]);

  const combined = search('сон', { counterparty_id: supplierMurod.id });
  assert.equal(combined.length, 0);

  assert.equal(search('нет такого слова').length, 0);
  assert.equal(search('   ').length, 2, 'пустой запрос не фильтрует');
});
