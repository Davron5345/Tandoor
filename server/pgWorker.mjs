/**
 * synckit worker: holds a pg Pool or PGlite instance and executes queries.
 * Transaction state lives here so BEGIN/COMMIT share one client.
 */
import { runAsWorker } from 'synckit';
import pg from 'pg';
import { translateSql, isPgliteUrl } from './sqlTranslate.js';
import {
  PG_CREATE_TABLES,
  PG_CREATE_INDEXES,
  PG_MIGRATION_SETTINGS_KEYS,
  PG_SCHEMA_VERSION,
} from './pgSchema.js';

const { Pool, types } = pg;

// Match sql.js numeric behaviour for aggregates / int8
types.setTypeParser(types.builtins.INT8, (v) => parseInt(v, 10));
types.setTypeParser(types.builtins.NUMERIC, (v) => parseFloat(v));

let pool = null;
let pglite = null;
let txClient = null;
let engine = null; // 'pg' | 'pglite'

async function getExecutor() {
  if (txClient) return txClient;
  if (engine === 'pglite') return pglite;
  return pool;
}

async function exec(sql, params = []) {
  const { sql: translated, params: bound } = translateSql(sql, params);
  try {
    const executor = await getExecutor();
    if (engine === 'pglite') {
      const result = await executor.query(translated, bound);
      return {
        rows: result.rows || [],
        rowCount: result.affectedRows ?? result.rows?.length ?? 0,
      };
    }
    const result = await executor.query(translated, bound);
    return { rows: result.rows, rowCount: result.rowCount ?? 0 };
  } catch (e) {
    e.message = `${e.message}\nSQL: ${translated}\nPARAMS: ${JSON.stringify(bound)}`;
    throw e;
  }
}

async function execRaw(sql, params = []) {
  const executor = await getExecutor();
  if (engine === 'pglite') {
    const result = await executor.query(sql, params);
    return {
      rows: result.rows || [],
      rowCount: result.affectedRows ?? result.rows?.length ?? 0,
    };
  }
  const result = await executor.query(sql, params);
  return { rows: result.rows, rowCount: result.rowCount ?? 0 };
}

async function runStatements(sqlBlob) {
  const parts = sqlBlob
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of parts) {
    await execRaw(stmt);
  }
}

async function ensureBootstrap() {
  await runStatements(PG_CREATE_TABLES);
  // Idempotent column adds for existing deployments BEFORE indexes that reference them
  await execRaw('ALTER TABLE document_items ADD COLUMN IF NOT EXISTS net_weight DOUBLE PRECISION');
  await execRaw('ALTER TABLE document_items ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0');
  await execRaw('ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS inn TEXT');
  await execRaw('ALTER TABLE payments ADD COLUMN IF NOT EXISTS external_ref TEXT');
  await execRaw('ALTER TABLE payments ADD COLUMN IF NOT EXISTS import_batch_id TEXT');
  await execRaw('ALTER TABLE payments ADD COLUMN IF NOT EXISTS contract_id TEXT');
  await runStatements(PG_CREATE_INDEXES);
  await execRaw(
    `INSERT INTO settings (key, value) VALUES ('counterparty_inn_v1', '1')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
  );
  await execRaw(
    `INSERT INTO settings (key, value) VALUES ('payment_bank_import_v1', '1')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
  );
  const sortMigrated = await execRaw(
    'SELECT value FROM settings WHERE key = $1',
    ['document_item_sort_order_v1'],
  );
  if (!sortMigrated.rows.length) {
    await execRaw(`
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY document_id ORDER BY ctid) - 1 AS rn
        FROM document_items
      )
      UPDATE document_items di
      SET sort_order = ranked.rn
      FROM ranked
      WHERE di.id = ranked.id
    `);
    await execRaw(
      `INSERT INTO settings (key, value) VALUES ($1, '1')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      ['document_item_sort_order_v1'],
    );
  }

  const ver = await execRaw('SELECT value FROM settings WHERE key = $1', [PG_SCHEMA_VERSION]);
  if (!ver.rows.length) {
    for (const key of PG_MIGRATION_SETTINGS_KEYS) {
      await execRaw(
        `INSERT INTO settings (key, value) VALUES ($1, '1')
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key],
      );
    }
    await execRaw(
      `INSERT INTO settings (key, value) VALUES ($1, '1')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [PG_SCHEMA_VERSION],
    );
  }

  const main = await execRaw('SELECT id FROM branches WHERE id = $1', ['main']);
  if (!main.rows.length) {
    await execRaw(
      `INSERT INTO branches (id, name, address, active) VALUES ('main', 'Главный филиал', '', 1)`,
    );
  }

  const wh = await execRaw('SELECT id FROM departments WHERE id = $1', ['main_wh']);
  if (!wh.rows.length) {
    await execRaw(
      `INSERT INTO departments (id, branch_id, name, active) VALUES ('main_wh', 'main', 'Склад', 1)
       ON CONFLICT DO NOTHING`,
    );
  }

  const raz = await execRaw('SELECT id FROM departments WHERE id = $1', ['razdel_cn']);
  if (!raz.rows.length) {
    await execRaw(
      `INSERT INTO departments (id, branch_id, name, active)
       VALUES ('razdel_cn', 'main', 'Разделочный цех', 1)
       ON CONFLICT DO NOTHING`,
    );
  }
}

async function init({ connectionString, dataDir }) {
  if (pool || pglite) {
    await ensureBootstrap();
    return { ok: true, engine };
  }

  if (isPgliteUrl(connectionString)) {
    const { PGlite } = await import('@electric-sql/pglite');
    const path = connectionString.startsWith('pglite:')
      ? connectionString.slice('pglite:'.length) || undefined
      : dataDir
        ? `${dataDir}/pglite`
        : undefined;
    pglite = path ? new PGlite(path) : new PGlite();
    await pglite.waitReady;
    engine = 'pglite';
  } else {
    pool = new Pool({
      connectionString,
      max: Number(process.env.PG_POOL_MAX || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
    });
    // Verify connectivity
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
    } finally {
      client.release();
    }
    engine = 'pg';
  }

  await ensureBootstrap();
  return { ok: true, engine };
}

async function queryAll(sql, params = []) {
  const { rows } = await exec(sql, params);
  return rows;
}

async function run(sql, params = []) {
  await exec(sql, params);
  return { ok: true };
}

async function begin() {
  if (txClient) throw new Error('Транзакция уже открыта');
  if (engine === 'pglite') {
    await pglite.query('BEGIN');
    txClient = pglite;
    return { ok: true };
  }
  txClient = await pool.connect();
  await txClient.query('BEGIN');
  return { ok: true };
}

async function commit() {
  if (!txClient) throw new Error('Нет активной транзакции');
  try {
    if (engine === 'pglite') {
      await pglite.query('COMMIT');
    } else {
      await txClient.query('COMMIT');
      txClient.release();
    }
  } finally {
    txClient = null;
  }
  return { ok: true };
}

async function rollback() {
  if (!txClient) return { ok: true };
  try {
    if (engine === 'pglite') {
      await pglite.query('ROLLBACK');
    } else {
      await txClient.query('ROLLBACK');
      txClient.release();
    }
  } catch {
    // ignore
  } finally {
    txClient = null;
  }
  return { ok: true };
}

async function health() {
  const { rows } = await execRaw('SELECT 1 AS ok');
  return { ok: rows[0]?.ok === 1 || rows[0]?.ok === '1', engine };
}

async function close() {
  if (txClient && engine === 'pg') {
    try {
      await txClient.query('ROLLBACK');
      txClient.release();
    } catch {
      // ignore
    }
    txClient = null;
  }
  if (pool) {
    await pool.end();
    pool = null;
  }
  if (pglite) {
    await pglite.close();
    pglite = null;
  }
  engine = null;
  return { ok: true };
}

runAsWorker(async (action, payload = {}) => {
  switch (action) {
    case 'init':
      return init(payload);
    case 'queryAll':
      return queryAll(payload.sql, payload.params || []);
    case 'run':
      return run(payload.sql, payload.params || []);
    case 'begin':
      return begin();
    case 'commit':
      return commit();
    case 'rollback':
      return rollback();
    case 'health':
      return health();
    case 'close':
      return close();
    case 'execRaw':
      return execRaw(payload.sql, payload.params || []);
    default:
      throw new Error(`Unknown pg worker action: ${action}`);
  }
});
