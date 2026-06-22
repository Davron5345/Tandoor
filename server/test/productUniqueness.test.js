import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir;

before(async () => {
  testDir = mkdtempSync(join(tmpdir(), 'warehouse-uniq-'));
  process.env.DATA_DIR = testDir;
  process.env.DISABLE_DEMO_SEED = 'true';
  process.env.NODE_ENV = 'test';

  const { initDb } = await import('../db.js');
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  await initDb();
  const db = (await import('../db.js')).default;
  initPermissions(db);
  seedDefaultUsers();
});

after(() => {
  if (testDir) rmSync(testDir, { recursive: true, force: true });
});

test('product names are unique among active products', async () => {
  const svc = await import('../services.js');

  svc.createProductCategory({ name: 'Прочее-test', sort_order: 999 });
  svc.createProduct({
    name: 'Яблоко-uniq',
    unit: 'кг',
    price: 1000,
    category_id: 'other',
    branch_id: 'main',
  });

  assert.throws(
    () => svc.createProduct({
      name: 'яблоко-uniq',
      unit: 'кг',
      price: 1200,
      category_id: 'other',
      branch_id: 'main',
    }),
    /уже существует/i,
  );
});

test('variant names may repeat across products but not within one product', async () => {
  const svc = await import('../services.js');

  svc.createProduct({
    name: 'Яблоко-var',
    unit: 'кг',
    price: 1000,
    category_id: 'other',
    branch_id: 'main',
    has_variants: true,
    variants: [{ name: 'Пикассо', price: 1000 }],
  });

  svc.createProduct({
    name: 'Картошка-var',
    unit: 'кг',
    price: 900,
    category_id: 'other',
    branch_id: 'main',
    has_variants: true,
    variants: [{ name: 'Пикассо', price: 900 }],
  });

  assert.throws(
    () => svc.createProduct({
      name: 'Лук-var',
      unit: 'кг',
      price: 800,
      category_id: 'other',
      branch_id: 'main',
      has_variants: true,
      variants: [
        { name: 'Пикассо', price: 800 },
        { name: 'пикассо', price: 850 },
      ],
    }),
    /повторяется в этом товаре/i,
  );
});

test('category names are unique per level and not shared between root and sub', async () => {
  const svc = await import('../services.js');

  const meat = svc.createProductCategory({ name: "Go'shtlar" });
  svc.createProductCategory({ name: 'Mol go\'shti', parent_id: meat.id });

  assert.throws(
    () => svc.createProductCategory({ name: "go'shtlar" }),
    /верхнего уровня/i,
  );

  svc.createProductCategory({ name: 'Mol go\'shti', parent_id: svc.createProductCategory({ name: 'Baliq' }).id });

  assert.throws(
    () => svc.createProductCategory({ name: 'Mol go\'shti', parent_id: meat.id }),
    /в этой категории/i,
  );

  assert.throws(
    () => svc.createProductCategory({ name: "Go'shtlar", parent_id: meat.id }),
    /верхнего уровня/i,
  );
});
