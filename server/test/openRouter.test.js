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
});
