import crypto from 'crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

let cachedAccount;
let cachedAccountRaw;
let cachedToken = null;

/** FCM_SERVICE_ACCOUNT_JSON: содержимое JSON-ключа сервисного аккаунта Firebase (как есть или base64). */
export function getServiceAccount() {
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON?.trim() || '';
  if (raw === cachedAccountRaw) return cachedAccount;
  cachedAccountRaw = raw;
  cachedAccount = null;
  cachedToken = null;
  if (!raw) return null;
  try {
    const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const parsed = JSON.parse(text);
    if (parsed.client_email && parsed.private_key && parsed.project_id) {
      cachedAccount = {
        clientEmail: parsed.client_email,
        privateKey: String(parsed.private_key).replace(/\\n/g, '\n'),
        projectId: parsed.project_id,
      };
    } else {
      console.warn('⚠️ FCM_SERVICE_ACCOUNT_JSON: нет client_email / private_key / project_id');
    }
  } catch (err) {
    console.warn('⚠️ FCM_SERVICE_ACCOUNT_JSON не читается:', err.message);
  }
  return cachedAccount;
}

export function isFcmV1Enabled() {
  return Boolean(getServiceAccount());
}

export function isLegacyFcmEnabled() {
  return Boolean(process.env.FCM_SERVER_KEY?.trim());
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

export function buildServiceAccountJwt(account, nowSec = Math.floor(Date.now() / 1000)) {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iss: account.clientEmail,
    scope: FCM_SCOPE,
    aud: TOKEN_URL,
    iat: nowSec,
    exp: nowSec + 3600,
  }));
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), account.privateKey);
  return `${header}.${claims}.${signature.toString('base64url')}`;
}

async function getAccessToken(account) {
  if (cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) {
    return cachedToken.value;
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: buildServiceAccountJwt(account),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`FCM OAuth: ${data.error_description || data.error || res.statusText}`);
  }
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  };
  return cachedToken.value;
}

function fcmErrorCode(data) {
  const details = data?.error?.details || [];
  const fcmDetail = details.find((d) => d?.errorCode);
  return fcmDetail?.errorCode || data?.error?.status || null;
}

/** @returns {{ ok: boolean, error?: string, unregistered?: boolean }} */
export async function sendFcmV1(token, payload) {
  const account = getServiceAccount();
  if (!account) return { ok: false, error: 'FCM not configured' };

  let accessToken;
  try {
    accessToken = await getAccessToken(account);
  } catch (err) {
    return { ok: false, error: err.message };
  }

  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${account.projectId}/messages:send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: payload.title, body: payload.body },
        data: {
          url: String(payload.url || '/warehouse/orders'),
          tag: String(payload.tag || 'notification'),
        },
        android: { priority: 'HIGH' },
      },
    }),
  });

  if (res.ok) return { ok: true };
  const data = await res.json().catch(() => ({}));
  const code = fcmErrorCode(data);
  if (res.status === 401) cachedToken = null;
  return {
    ok: false,
    error: code || data?.error?.message || res.statusText,
    unregistered: code === 'UNREGISTERED' || (res.status === 404 && code === 'NOT_FOUND'),
  };
}

export async function sendFcmLegacy(token, payload) {
  const key = process.env.FCM_SERVER_KEY?.trim();
  if (!key) return { ok: false, error: 'FCM not configured' };

  const res = await fetch('https://fcm.googleapis.com/fcm/send', {
    method: 'POST',
    headers: {
      Authorization: `key=${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: token,
      priority: 'high',
      notification: { title: payload.title, body: payload.body },
      data: {
        url: payload.url || '/warehouse/orders',
        tag: payload.tag || 'notification',
      },
    }),
  });

  const data = await res.json().catch(() => ({}));
  const errorCode = data?.results?.[0]?.error;
  if (!res.ok || data?.failure) {
    return {
      ok: false,
      error: errorCode || res.statusText,
      unregistered: errorCode === 'NotRegistered' || errorCode === 'InvalidRegistration',
    };
  }
  return { ok: true };
}
