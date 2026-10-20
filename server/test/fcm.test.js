import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { getServiceAccount, buildServiceAccountJwt, sendFcmV1, isFcmV1Enabled } from '../fcm.js';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const serviceAccount = {
  type: 'service_account',
  project_id: 'tandoor-test',
  client_email: 'push@tandoor-test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
};

function withAccount(value, fn) {
  const prev = process.env.FCM_SERVICE_ACCOUNT_JSON;
  process.env.FCM_SERVICE_ACCOUNT_JSON = value;
  return Promise.resolve(fn()).finally(() => {
    if (prev === undefined) delete process.env.FCM_SERVICE_ACCOUNT_JSON;
    else process.env.FCM_SERVICE_ACCOUNT_JSON = prev;
  });
}

function mockFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

test('service account is read from raw JSON and base64', async () => {
  await withAccount(JSON.stringify(serviceAccount), () => {
    assert.equal(getServiceAccount().projectId, 'tandoor-test');
    assert.equal(isFcmV1Enabled(), true);
  });
  await withAccount(Buffer.from(JSON.stringify(serviceAccount)).toString('base64'), () => {
    assert.equal(getServiceAccount().clientEmail, serviceAccount.client_email);
  });
  await withAccount('', () => {
    assert.equal(isFcmV1Enabled(), false);
  });
});

test('service account JWT is signed with RS256 and FCM scope', async () => {
  await withAccount(JSON.stringify(serviceAccount), () => {
    const jwt = buildServiceAccountJwt(getServiceAccount(), 1_000_000);
    const [h, c, s] = jwt.split('.');
    const ok = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${c}`), publicKey, Buffer.from(s, 'base64url'));
    assert.equal(ok, true);
    const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
    assert.equal(claims.iss, serviceAccount.client_email);
    assert.equal(claims.scope, 'https://www.googleapis.com/auth/firebase.messaging');
    assert.equal(claims.exp - claims.iat, 3600);
  });
});

test('sendFcmV1 sends message and flags unregistered tokens', async () => {
  await withAccount(JSON.stringify({ ...serviceAccount, project_id: 'tandoor-send' }), async () => {
    const mock = mockFetch((url, init) => {
      if (url.includes('oauth2')) return json(200, { access_token: 'ya29.test', expires_in: 3600 });
      const body = JSON.parse(init.body);
      if (body.message.token === 'dead-token') {
        return json(404, { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } });
      }
      return json(200, { name: 'projects/tandoor-send/messages/1' });
    });
    try {
      const ok = await sendFcmV1('live-token', { title: 'Заявка', body: '2 поз.', url: '/snab' });
      assert.deepEqual(ok, { ok: true });
      const sendCall = mock.calls.find((c) => c.url.includes('/v1/projects/tandoor-send/messages:send'));
      assert.ok(sendCall);
      assert.equal(sendCall.init.headers.Authorization, 'Bearer ya29.test');
      const msg = JSON.parse(sendCall.init.body).message;
      assert.equal(msg.notification.title, 'Заявка');
      assert.equal(msg.data.url, '/snab');

      const dead = await sendFcmV1('dead-token', { title: 'x', body: 'y' });
      assert.equal(dead.ok, false);
      assert.equal(dead.unregistered, true);
      assert.equal(mock.calls.filter((c) => c.url.includes('oauth2')).length, 1);
    } finally {
      mock.restore();
    }
  });
});
