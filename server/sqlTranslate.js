/**
 * Translates SQLite-flavoured SQL (used across the app) into Postgres.
 * Keeps TEXT datetime strings compatible with existing comparisons.
 */

const PG_NOW_TEXT = "TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')";

function replacePlaceholders(sql) {
  let result = '';
  let i = 0;
  let n = 0;
  let inString = false;
  while (i < sql.length) {
    const c = sql[i];
    if (!inString) {
      if (c === "'") {
        inString = true;
        result += c;
        i += 1;
        continue;
      }
      if (c === '?') {
        n += 1;
        result += `$${n}`;
        i += 1;
        continue;
      }
      result += c;
      i += 1;
      continue;
    }
    result += c;
    if (c === "'") {
      if (sql[i + 1] === "'") {
        result += "'";
        i += 2;
        continue;
      }
      inString = false;
    }
    i += 1;
  }
  return result;
}

/**
 * SQLite: `col IS ?` with null param → IS NULL.
 * Postgres rejects `IS $1`.
 */
function rewriteIsPlaceholders(sql, params) {
  if (!params?.length) return { sql, params: params || [] };
  const outParams = [];
  let paramIdx = 0;
  let inString = false;
  let result = '';
  let i = 0;

  while (i < sql.length) {
    const c = sql[i];
    if (!inString) {
      if (c === "'") {
        inString = true;
        result += c;
        i += 1;
        continue;
      }

      const rest = sql.slice(i);
      const isNot = /^IS\s+NOT\s+\?/i.exec(rest);
      const isYes = !isNot && /^IS\s+\?/i.exec(rest);
      if (isNot || isYes) {
        const match = isNot || isYes;
        const value = params[paramIdx++];
        if (value === null || value === undefined) {
          result += isNot ? 'IS NOT NULL' : 'IS NULL';
        } else if (isNot) {
          outParams.push(value);
          result += 'IS DISTINCT FROM ?';
        } else {
          outParams.push(value);
          result += 'IS NOT DISTINCT FROM ?';
        }
        i += match[0].length;
        continue;
      }

      if (c === '?') {
        outParams.push(params[paramIdx++]);
        result += '?';
        i += 1;
        continue;
      }

      result += c;
      i += 1;
      continue;
    }

    result += c;
    if (c === "'") {
      if (sql[i + 1] === "'") {
        result += "'";
        i += 2;
        continue;
      }
      inString = false;
    }
    i += 1;
  }

  return { sql: result, params: outParams };
}

function translateInsertOrReplace(sql) {
  const m = sql.match(
    /^(\s*)INSERT\s+OR\s+REPLACE\s+INTO\s+([a-zA-Z_][\w.]*)\s*(\([^)]+\))\s*(VALUES\s*\([\s\S]*\))\s*(;?\s*)$/i,
  );
  if (!m) {
    return sql.replace(/INSERT\s+OR\s+REPLACE\s+INTO/gi, 'INSERT INTO');
  }
  const [, lead, table, colsPart, valuesPart, tail] = m;
  const cols = colsPart
    .slice(1, -1)
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  if (!cols.length) {
    return `${lead}INSERT INTO ${table} ${colsPart} ${valuesPart}${tail || ''}`;
  }
  const conflictCol = cols[0];
  const updates = cols
    .slice(1)
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(', ');
  const onConflict = updates
    ? ` ON CONFLICT (${conflictCol}) DO UPDATE SET ${updates}`
    : ` ON CONFLICT (${conflictCol}) DO NOTHING`;
  return `${lead}INSERT INTO ${table} ${colsPart} ${valuesPart}${onConflict}${tail || ''}`;
}

function translateInsertOrIgnore(sql) {
  const stripped = sql.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO');
  if (/ON\s+CONFLICT/i.test(stripped)) return stripped;
  const trimmed = stripped.trimEnd();
  const hasSemi = trimmed.endsWith(';');
  const body = hasSemi ? trimmed.slice(0, -1) : trimmed;
  return `${body} ON CONFLICT DO NOTHING${hasSemi ? ';' : ''}`;
}

function applyDialect(sql) {
  let s = sql;

  s = s.replace(/\bIFNULL\s*\(/gi, 'COALESCE(');

  s = s.replace(/strftime\s*\(\s*'%Y-%m'\s*,\s*([^)]+?)\)/gi, 'substr($1, 1, 7)');

  s = s.replace(
    /date\s*\(\s*'now'\s*,\s*'start of month'\s*,\s*'-(\d+)\s*months?'\s*\)/gi,
    (_m, n) => `TO_CHAR(DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '${n} months', 'YYYY-MM-DD')`,
  );

  s = s.replace(
    /datetime\s*\(\s*'now'\s*,\s*'-'\s*\|\|\s*\?\s*\|\|\s*' days'\s*\)/gi,
    `TO_CHAR(NOW() - ((?::text) || ' days')::interval, 'YYYY-MM-DD HH24:MI:SS')`,
  );

  s = s.replace(
    /datetime\s*\(\s*'now'\s*,\s*'-(\d+)\s*(minutes?|hours?|days?)'\s*\)/gi,
    (_m, n, unit) => {
      const lower = unit.toLowerCase();
      const u = lower.startsWith('minute') ? 'minutes' : lower.startsWith('hour') ? 'hours' : 'days';
      return `TO_CHAR(NOW() - INTERVAL '${n} ${u}', 'YYYY-MM-DD HH24:MI:SS')`;
    },
  );

  s = s.replace(/datetime\s*\(\s*'now'\s*\)/gi, PG_NOW_TEXT);
  s = s.replace(/date\s*\(\s*'now'\s*\)/gi, `TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD')`);

  s = s.replace(
    /([a-zA-Z_][\w.]*)\s*=\s*\?\s*COLLATE\s+NOCASE/gi,
    'lower($1) = lower(?)',
  );
  s = s.replace(
    /,\s*([a-zA-Z_][\w.]*)\s+COLLATE\s+NOCASE/gi,
    ', lower($1)',
  );
  s = s.replace(
    /ORDER\s+BY\s+([a-zA-Z_][\w.]*)\s+COLLATE\s+NOCASE/gi,
    'ORDER BY lower($1)',
  );
  s = s.replace(/\s+COLLATE\s+NOCASE/gi, '');

  return s;
}

/**
 * @param {string} sql
 * @param {any[]} [params]
 * @returns {{ sql: string, params: any[] }}
 */
export function translateSql(sql, params = []) {
  if (!sql || typeof sql !== 'string') return { sql, params };

  let out = sql;
  if (/INSERT\s+OR\s+REPLACE\s+INTO/i.test(out)) {
    out = translateInsertOrReplace(out);
  } else if (/INSERT\s+OR\s+IGNORE\s+INTO/i.test(out)) {
    out = translateInsertOrIgnore(out);
  }

  out = applyDialect(out);
  const rewritten = rewriteIsPlaceholders(out, params);
  return {
    sql: replacePlaceholders(rewritten.sql),
    params: rewritten.params,
  };
}

export function isPostgresEnabled() {
  const url = process.env.DATABASE_URL || '';
  if (!url) return false;
  if (process.env.DB_ENGINE === 'sqlite') return false;
  return true;
}

export function isPgliteUrl(url = process.env.DATABASE_URL || '') {
  return (
    process.env.DB_ENGINE === 'pglite'
    || url === 'pglite'
    || url.startsWith('pglite:')
  );
}
