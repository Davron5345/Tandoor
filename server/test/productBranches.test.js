import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir;

before(() => {
  testDir = mkdtempSync(join(tmpdir(), 'warehouse-pb-'));
  process.env.DATA_DIR = testDir;
  process.env.DISABLE_DEMO_SEED = 'true';
  process.env.NODE_ENV = 'test';
});

after(() => {
  if (testDir) rmSync(testDir, { recursive: true, force: true });
});

test('product branch visibility and price overrides', async () => {
  const { initDb } = await import('../db.js');
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  const { createBranch } = await import('../branches.js');
  const svc = await import('../services.js');
  const {
    saveProductBranchSettings,
    getEffectiveProductPrice,
    isProductVisibleInBranch,
    getProductBranchSettings,
  } = await import('../productBranches.js');

  await initDb();
  const db = (await import('../db.js')).default;
  initPermissions(db);
  seedDefaultUsers();

  const branch2 = createBranch({ id: 'b2', name: 'Филиал 2' });

  const product = svc.createProduct({
    name: 'Товар филиалов',
    sku: 'BR-1',
    unit: 'шт',
    price: 1000,
    branch_id: 'main',
    branch_settings: [
      { branch_id: 'main', visible: true, price: 1200 },
      { branch_id: branch2.id, visible: false, price: 1500 },
    ],
  });

  assert.equal(isProductVisibleInBranch(product.id, 'main'), true);
  assert.equal(isProductVisibleInBranch(product.id, branch2.id), false);
  assert.equal(getEffectiveProductPrice(product.id, 'main'), 1200);
  assert.equal(getEffectiveProductPrice(product.id, branch2.id), 1500);

  const mainList = svc.getProducts({ branch_id: 'main' });
  assert.ok(mainList.some((p) => p.id === product.id));
  assert.equal(mainList.find((p) => p.id === product.id).price, 1200);

  const branch2List = svc.getProducts({ branch_id: branch2.id });
  assert.equal(branch2List.some((p) => p.id === product.id), false);

  saveProductBranchSettings(product.id, [
    { branch_id: branch2.id, visible: true, price: 1800 },
  ]);
  const visibleList = svc.getProducts({ branch_id: branch2.id });
  assert.ok(visibleList.some((p) => p.id === product.id));
  assert.equal(visibleList.find((p) => p.id === product.id).price, 1800);

  const settings = getProductBranchSettings(product.id);
  assert.equal(settings.length, 2);
  assert.equal(settings.find((s) => s.branch_id === 'main').visible, true);
  assert.equal(settings.find((s) => s.branch_id === branch2.id).price, 1800);
});
