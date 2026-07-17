#!/usr/bin/env node
/**
 * One-shot import: SQLite warehouse.db → Postgres (DATABASE_URL).
 *
 * Usage:
 *   DATABASE_URL=postgres://... node server/scripts/migrate-sqlite-to-postgres.mjs [path/to/warehouse.db]
 *
 * Env:
 *   SQLITE_PATH     — override source path (default: DATA_DIR/warehouse.db)
 *   MIGRATE_DRY_RUN — if true, only print counts, no writes
 *   MIGRATE_TRUNCATE — if true, TRUNCATE all target tables before import
 */
import dotenv from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import initSqlJs from 'sql.js';
import pg from 'pg';
import { PG_TABLE_IMPORT_ORDER, PG_CREATE_TABLES, PG_CREATE_INDEXES, PG_MIGRATION_SETTINGS_KEYS, PG_SCHEMA_VERSION } from '../pgSchema.js';

dotenv.config();

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveSqlitePath() {
  if (process.argv[2]) return process.argv[2];
  if (process.env.SQLITE_PATH) return process.env.SQLITE_PATH;
  const dataDir = process.env.DATA_DIR || process.env.WAREHOUSE_DATA_DIR
    || join(__dirname, '..', '..', 'data');
  return join(dataDir, 'warehouse.db');
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

async function runStatements(client, sqlBlob) {
  const parts = sqlBlob.split(';').map((s) => s.trim()).filter(Boolean);
  for (const stmt of parts) {
    await client.query(stmt);
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || databaseUrl.startsWith('pglite')) {
    console.error('Укажите DATABASE_URL=postgres://... (не pglite)');
    process.exit(1);
  }

  const sqlitePath = resolveSqlitePath();
  if (!existsSync(sqlitePath)) {
    console.error(`SQLite файл не найден: ${sqlitePath}`);
    process.exit(1);
  }

  const dryRun = process.env.MIGRATE_DRY_RUN === 'true' || process.env.MIGRATE_DRY_RUN === '1';
  const doTruncate = process.env.MIGRATE_TRUNCATE === 'true' || process.env.MIGRATE_TRUNCATE === '1';

  console.log(`📦 SQLite: ${sqlitePath}`);
  console.log(`🐘 Postgres: ${databaseUrl.replace(/:[^:@/]+@/, ':***@')}`);
  if (dryRun) console.log('🔍 DRY RUN — только сверка/подсчёт');

  const SQL = await initSqlJs();
  const sqlite = new SQL.Database(readFileSync(sqlitePath));

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    await runStatements(client, PG_CREATE_TABLES);
    await runStatements(client, PG_CREATE_INDEXES);

    const sqliteCounts = {};
    for (const table of PG_TABLE_IMPORT_ORDER) {
      try {
        const stmt = sqlite.prepare(`SELECT COUNT(*) as c FROM ${table}`);
        stmt.step();
        sqliteCounts[table] = Number(stmt.getAsObject().c) || 0;
        stmt.free();
      } catch {
        sqliteCounts[table] = null;
      }
    }

    console.log('\nSQLite row counts:');
    for (const [t, c] of Object.entries(sqliteCounts)) {
      console.log(`  ${t}: ${c === null ? '(нет таблицы)' : c}`);
    }

    if (dryRun) {
      for (const table of PG_TABLE_IMPORT_ORDER) {
        if (sqliteCounts[table] == null) continue;
        try {
          const { rows } = await client.query(`SELECT COUNT(*)::int AS c FROM ${quoteIdent(table)}`);
          console.log(`  PG ${table}: ${rows[0].c}`);
        } catch {
          console.log(`  PG ${table}: (нет таблицы)`);
        }
      }
      return;
    }

    await client.query('BEGIN');
    try {
      if (doTruncate) {
        const list = PG_TABLE_IMPORT_ORDER.map(quoteIdent).reverse().join(', ');
        await client.query(`TRUNCATE ${list} CASCADE`);
        console.log('🧹 TRUNCATE CASCADE выполнен');
      }

      for (const table of PG_TABLE_IMPORT_ORDER) {
        if (sqliteCounts[table] == null) continue;
        const count = sqliteCounts[table];
        if (count === 0) continue;

        const colStmt = sqlite.prepare(`PRAGMA table_info(${table})`);
        const cols = [];
        while (colStmt.step()) {
          cols.push(colStmt.getAsObject().name);
        }
        colStmt.free();
        if (!cols.length) continue;

        const colList = cols.map(quoteIdent).join(', ');
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
        const insertSql = `INSERT INTO ${quoteIdent(table)} (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;

        const selectSql = `SELECT ${cols.map((c) => `"${c}"`).join(', ')} FROM ${table}`;
        const dataStmt = sqlite.prepare(selectSql);
        let inserted = 0;
        while (dataStmt.step()) {
          const row = dataStmt.getAsObject();
          const values = cols.map((c) => {
            const v = row[c];
            return v === undefined ? null : v;
          });
          await client.query(insertSql, values);
          inserted += 1;
        }
        dataStmt.free();
        console.log(`  ✓ ${table}: ${inserted}/${count}`);
      }

      for (const key of PG_MIGRATION_SETTINGS_KEYS) {
        await client.query(
          `INSERT INTO settings (key, value) VALUES ($1, '1')
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [key],
        );
      }
      await client.query(
        `INSERT INTO settings (key, value) VALUES ($1, '1')
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [PG_SCHEMA_VERSION],
      );

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }

    console.log('\nСверка COUNT(*):');
    let mismatches = 0;
    for (const table of PG_TABLE_IMPORT_ORDER) {
      if (sqliteCounts[table] == null) continue;
      const { rows } = await client.query(`SELECT COUNT(*)::int AS c FROM ${quoteIdent(table)}`);
      const pgCount = rows[0].c;
      const sq = sqliteCounts[table];
      // ON CONFLICT DO NOTHING may skip dupes; allow >= when truncate was used we expect equal
      const ok = doTruncate ? pgCount === sq : pgCount >= sq || pgCount === sq;
      const mark = pgCount === sq ? 'OK' : (ok ? 'OK~' : 'DIFF');
      if (pgCount !== sq) mismatches += 1;
      console.log(`  [${mark}] ${table}: sqlite=${sq} pg=${pgCount}`);
    }

    // Key checksums
    const checksums = [
      ['documents confirmed', `SELECT COUNT(*)::int AS c FROM documents WHERE status = 'confirmed'`],
      ['payments sum', `SELECT COALESCE(SUM(amount), 0)::float AS c FROM payments`],
      ['dept stock sum', `SELECT COALESCE(SUM(stock), 0)::float AS c FROM product_department_stock`],
      ['users', `SELECT COUNT(*)::int AS c FROM users`],
    ];

    console.log('\nКонтрольные суммы (Postgres):');
    for (const [label, sql] of checksums) {
      const { rows } = await client.query(sql);
      console.log(`  ${label}: ${rows[0].c}`);
    }

    // SQLite checksums for comparison
    console.log('\nКонтрольные суммы (SQLite):');
    const sqliteChecks = [
      ['documents confirmed', `SELECT COUNT(*) as c FROM documents WHERE status = 'confirmed'`],
      ['payments sum', `SELECT COALESCE(SUM(amount), 0) as c FROM payments`],
      ['dept stock sum', `SELECT COALESCE(SUM(stock), 0) as c FROM product_department_stock`],
      ['users', `SELECT COUNT(*) as c FROM users`],
    ];
    for (const [label, sql] of sqliteChecks) {
      try {
        const stmt = sqlite.prepare(sql);
        stmt.step();
        console.log(`  ${label}: ${stmt.getAsObject().c}`);
        stmt.free();
      } catch (e) {
        console.log(`  ${label}: error ${e.message}`);
      }
    }

    if (mismatches && doTruncate) {
      console.error(`\n❌ Есть расхождения COUNT (${mismatches} таблиц). Проверьте лог.`);
      process.exit(2);
    }

    console.log('\n✅ Импорт завершён. Дальше: задеплойте код с DATABASE_URL и проверьте /api/health.');
  } finally {
    client.release();
    await pool.end();
    sqlite.close();
  }
}

main().catch((err) => {
  console.error('❌ Миграция failed:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
