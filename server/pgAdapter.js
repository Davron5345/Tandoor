/**
 * Sync Postgres adapter (same surface as sql.js helpers in db.js).
 * Lazy-loads synckit worker only when Postgres is actually used.
 */
import { createSyncFn } from 'synckit';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { isPgliteUrl } from './sqlTranslate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workerPath = join(__dirname, 'pgWorker.mjs');

let syncCall = null;
let ready = false;
let engine = null;

function getSyncCall() {
  if (!syncCall) {
    syncCall = createSyncFn(workerPath, {
      timeout: Number(process.env.PG_SYNC_TIMEOUT_MS || 120_000),
    });
  }
  return syncCall;
}

export function pgInit(connectionString = process.env.DATABASE_URL, dataDir) {
  const call = getSyncCall();
  const result = call('init', {
    connectionString: connectionString || 'pglite',
    dataDir,
  });
  ready = true;
  engine = result?.engine || (isPgliteUrl(connectionString) ? 'pglite' : 'pg');
  return result;
}

export function pgQueryAll(sql, params = []) {
  if (!ready) throw new Error('Postgres не инициализирован');
  return getSyncCall()('queryAll', { sql, params });
}

export function pgQueryOne(sql, params = []) {
  const rows = pgQueryAll(sql, params);
  return rows[0] || null;
}

export function pgRun(sql, params = []) {
  if (!ready) throw new Error('Postgres не инициализирован');
  return getSyncCall()('run', { sql, params });
}

export function pgTransaction(fn) {
  if (!ready) throw new Error('Postgres не инициализирован');
  const call = getSyncCall();
  call('begin');
  try {
    fn();
    call('commit');
  } catch (e) {
    try {
      call('rollback');
    } catch {
      // ignore
    }
    throw e;
  }
}

export function pgHealth() {
  if (!ready) return { ok: false, error: 'not initialized' };
  return getSyncCall()('health');
}

export function pgClose() {
  if (!ready) return;
  try {
    getSyncCall()('close');
  } finally {
    ready = false;
    engine = null;
  }
}

export function pgEngine() {
  return engine;
}

export function pgIsReady() {
  return ready;
}

export function pgExecRaw(sql, params = []) {
  if (!ready) throw new Error('Postgres не инициализирован');
  return getSyncCall()('execRaw', { sql, params });
}
