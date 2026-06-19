import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCorsOptions } from '../corsConfig.js';

function checkOrigin(env, origin) {
  const prev = { ...process.env };
  Object.assign(process.env, env);
  return new Promise((resolve, reject) => {
    createCorsOptions().origin(origin, (err, allowed) => {
      Object.assign(process.env, prev);
      if (err) reject(err);
      else resolve(allowed);
    });
  });
}

test('production monolith allows same-host origin when CORS_ORIGIN unset', async () => {
  const allowed = await checkOrigin(
    { NODE_ENV: 'production', CORS_ORIGIN: '', RAILWAY_PUBLIC_DOMAIN: 'app.example.com' },
    'https://app.example.com',
  );
  assert.equal(allowed, true);
});

test('production blocks unknown origin when CORS_ORIGIN is set', async () => {
  await assert.rejects(
    () => checkOrigin(
      { NODE_ENV: 'production', CORS_ORIGIN: 'https://allowed.com' },
      'https://evil.com',
    ),
    /CORS: origin not allowed/,
  );
});
