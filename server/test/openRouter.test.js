import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dataDir = mkdtempSync(join(tmpdir(), 'tandoor-ai-'));
process.env.DATA_DIR = dataDir;
process.env.DISABLE_DEMO_SEED = 'true';
delete process.env.DATABASE_URL;
delete process.env.DB_ENGINE;

describe('OpenRouter settings', () => {
  let db;
  let openRouter;

  before(async () => {
    db = await import('../db.js');
    await db.initDb();
    openRouter = await import('../services/openRouter.js');
  });

  after(() => {
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('starts without key', () => {
    const s = openRouter.getOpenRouterSettings();
    assert.equal(s.has_api_key, false);
    assert.equal(s.ready, false);
    assert.ok(s.model);
  });

  it('saves api key and model', () => {
    const s = openRouter.saveOpenRouterSettings({
      api_key: 'sk-or-v1-testkey1234567890',
      model: 'google/gemini-2.5-flash',
    });
    assert.equal(s.has_api_key, true);
    assert.equal(s.ready, true);
    assert.equal(s.model, 'google/gemini-2.5-flash');
    assert.match(s.api_key_masked, /sk-or|••••|test/);
  });

  it('clears api key', () => {
    const s = openRouter.saveOpenRouterSettings({ clear_api_key: true });
    assert.equal(s.has_api_key, false);
    assert.equal(s.ready, false);
  });

  it('normalizes multi-supplier notebook JSON', () => {
    const n = openRouter.normalizePrihodExtraction({
      groups: [
        {
          supplier: 'Перег: Абдулазиз Мекан',
          section: 'Перег Абдулазиз',
          items: [
            { name: 'Кур филе', quantity: '5,1', unit: 'кг', price: 46000, amount: 234600 },
            { name: 'Кур куй', quantity: 3, unit: 'шт', price: 43000 },
          ],
        },
        {
          supplier: 'РМ рыбное местечко',
          items: [
            { name: 'лосось хол коп', quantity: 2.5, unit: 'кг', amount: 1000000 },
          ],
        },
      ],
      extra_costs: [
        { title: 'стоянка', amount: 20000 },
        { title: 'бенз', amount: '200000', capitalize: false },
      ],
      total: '16958033,58',
    });
    assert.equal(n.groups.length, 2);
    assert.equal(n.groups[0].supplier, 'Абдулазиз Мекан');
    assert.equal(n.groups[0].items[0].quantity, 5.1);
    assert.equal(n.groups[0].items[0].price, 46000);
    assert.equal(n.groups[1].items[0].price, 400000); // amount/qty
    assert.equal(n.extra_costs.length, 2);
    assert.equal(n.extra_costs[0].capitalize, false);
    assert.equal(n.total, 16958033.58);
    assert.equal(n.items.length, 3);
  });

  it('keeps legacy single-supplier format', () => {
    const n = openRouter.normalizePrihodExtraction({
      supplier: 'Жалилдан',
      items: [{ name: 'Сон', quantity: 45.8, unit: 'кг', price: null }],
    });
    assert.equal(n.groups.length, 1);
    assert.equal(n.supplier, 'Жалил');
    assert.equal(n.items[0].name, 'Сон');
  });
});
