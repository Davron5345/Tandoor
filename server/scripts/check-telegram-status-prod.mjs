#!/usr/bin/env node
/** Prod check without printing secrets. */
import pg from 'pg';

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const settings = await c.query(`
  SELECT key,
    CASE WHEN length(coalesce(value,'')) > 0 THEN 'SET:len=' || length(value) ELSE 'EMPTY' END AS v
  FROM settings
  WHERE key IN ('telegram_bot_token', 'openrouter_config')
`);
console.log('SETTINGS', JSON.stringify(settings.rows));

const topics = await c.query(`
  SELECT chat_title, title, mode, branch_id,
    (department_id IS NOT NULL) AS has_dept,
    auto_create, auto_confirm, notify, last_message_at
  FROM telegram_topics
  ORDER BY last_message_at DESC NULLS LAST
  LIMIT 20
`);
console.log('TOPICS', JSON.stringify(topics.rows, null, 2));
console.log('PRIHOD_ON', topics.rows.filter((t) => t.mode === 'prihod').length);
console.log('TELEGRAM_ENABLED_ENV', process.env.TELEGRAM_ENABLED || '(unset)');
console.log('HAS_ENV_TOKEN', !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_TOKEN.length > 10));

const tokenRow = await c.query(`SELECT value FROM settings WHERE key = 'telegram_bot_token'`);
const token = tokenRow.rows[0]?.value || process.env.TELEGRAM_BOT_TOKEN || '';
if (!token) {
  console.log('BOT', JSON.stringify({ ok: false, reason: 'no_token' }));
} else {
  const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  const body = await res.json();
  console.log('BOT', JSON.stringify({
    http: res.status,
    ok: body.ok,
    username: body.result?.username || null,
    can_join_groups: body.result?.can_join_groups,
    can_read_all_group_messages: body.result?.can_read_all_group_messages,
  }));
}

await c.end();
