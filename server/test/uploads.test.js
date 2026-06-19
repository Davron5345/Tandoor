import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createServer } from 'http';

let testDir;
let server;
let baseUrl;
let adminCookie;

before(async () => {
  testDir = mkdtempSync(join(tmpdir(), 'warehouse-uploads-'));
  process.env.DATA_DIR = testDir;
  process.env.DISABLE_DEMO_SEED = 'true';
  process.env.NODE_ENV = 'test';
  process.env.TELEGRAM_ENABLED = 'false';

  const { default: db, initDb } = await import('../db.js');
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  const { createApp } = await import('../app.js');
  const svc = await import('../services.js');
  const { ensureProductDir } = await import('../productImages.js');

  await initDb();
  initPermissions(db);
  seedDefaultUsers();

  const product = svc.createProduct({
    name: 'Фото-товар',
    sku: 'IMG-001',
    unit: 'шт',
    price: 100,
    branch_id: 'main',
  });

  const fileName = 'test-image.jpg';
  const dir = ensureProductDir(product.id);
  writeFileSync(join(dir, fileName), Buffer.from('fake-jpeg'));

  db.run(`
    INSERT INTO product_images (id, product_id, variant_id, file_name, original_name, mime_type, media_type, size, sort_order, is_primary)
    VALUES (?, ?, NULL, ?, ?, 'image/jpeg', 'photo', 9, 1, 1)
  `, ['img-test-1', product.id, fileName, fileName]);

  const app = createApp();
  await new Promise((resolve) => {
    server = createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  adminCookie = loginRes.headers.get('set-cookie')?.split(';')[0];
  assert.ok(adminCookie);
});

after(() => {
  if (server) server.close();
  if (testDir) rmSync(testDir, { recursive: true, force: true });
});

test('uploads require authentication', async () => {
  const res = await fetch(`${baseUrl}/uploads/products/any/id.jpg`);
  assert.equal(res.status, 401);
});

test('authenticated user can load registered product image', async () => {
  const { default: db } = await import('../db.js');
  const row = db.queryOne('SELECT product_id, file_name FROM product_images LIMIT 1');
  assert.ok(row);

  const res = await fetch(`${baseUrl}/uploads/products/${row.product_id}/${row.file_name}`, {
    headers: { cookie: adminCookie },
  });
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.equal(body, 'fake-jpeg');
});

test('unregistered upload path returns 404', async () => {
  const res = await fetch(`${baseUrl}/uploads/products/missing-product/nope.jpg`, {
    headers: { cookie: adminCookie },
  });
  assert.equal(res.status, 404);
});

test('openapi spec is publicly available', async () => {
  const res = await fetch(`${baseUrl}/api/openapi.json`);
  assert.equal(res.status, 200);
  const spec = await res.json();
  assert.equal(spec.openapi, '3.0.3');
  assert.ok(spec.paths['/auth/login']);
});
