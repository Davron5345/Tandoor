#!/usr/bin/env node
/**
 * One-shot prod check: Telegram bot token, OpenRouter, topics (no secrets printed).
 * Usage inside service: node server/scripts/check-telegram-ai-prod.mjs
 */
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('NO_DATABASE_URL');
  process.exit(1);
}

const c = new pg.Client({ connectionString: url });
await c.connect();

const settings = await c.query(`
  SELECT key,
    CASE WHEN length(coalesce(value,'')) > 0
      THEN 'SET:len=' || length(value)
      ELSE 'EMPTY'
    END AS v
  FROM settings
  WHERE key IN ('telegram_bot_token', 'openrouter_config')
`);
console.log('SETTINGS', JSON.stringify(settings.rows));

const or = await c.query(`SELECT value FROM settings WHERE key = 'openrouter_config'`);
if (or.rows[0]?.value) {
  try {
    const j = JSON.parse(or.rows[0].value);
    console.log('OPENROUTER', JSON.stringify({
      has_key: !!(j.api_key && String(j.api_key).length > 5),
      model: j.model || null,
      models_cached: Array.isArray(j.models_cache) ? j.models_cache.length : 0,
      models_updated_at: j.models_updated_at || null,
      ready: !!(j.api_key && j.model),
    }));
  } catch (e) {
    console.log('OPENROUTER_PARSE_ERR', e.message);
  }
} else {
  console.log('OPENROUTER', JSON.stringify({ ready: false, reason: 'missing' }));
}

const topics = await c.query(`
  SELECT chat_title, title, mode, branch_id,
    (department_id IS NOT NULL) AS has_dept,
    auto_create, auto_confirm, notify, last_message_at
  FROM telegram_topics
  ORDER BY last_message_at DESC NULLS LAST
  LIMIT 30
`);
console.log('TOPICS_COUNT', topics.rows.length);
console.log('TOPICS', JSON.stringify(topics.rows, null, 2));

const prihodTopics = topics.rows.filter((t) => t.mode === 'prihod');
console.log('PRIHOD_TOPICS', prihodTopics.length);
for (const t of prihodTopics) {
  const ok = t.has_dept && t.branch_id;
  console.log('PRIHOD_OK', ok, JSON.stringify({
    chat: t.chat_title,
    topic: t.title,
    branch_id: t.branch_id,
    has_dept: t.has_dept,
    auto_create: t.auto_create,
    auto_confirm: t.auto_confirm,
    notify: t.notify,
    last_message_at: t.last_message_at,
  }));
}

const inbox = await c.query(`
  SELECT status, source, count(*)::int AS c
  FROM telegram_inbox
  GROUP BY 1, 2
  ORDER BY 1, 2
`);
console.log('INBOX', JSON.stringify(inbox.rows));

const ai = await c.query(`
  SELECT count(*)::int AS ai_docs,
    coalesce(sum(CASE WHEN ai_unconfirmed_count > 0 THEN 1 ELSE 0 END), 0)::int AS with_unconfirmed
  FROM documents
  WHERE coalesce(ai_recognized, 0) = 1
`);
console.log('AI_DOCS', JSON.stringify(ai.rows[0]));

await c.end();
