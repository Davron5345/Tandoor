const SESSION_COOKIE = 'warehouse_session';
const SESSION_MAX_AGE_SEC = 7 * 24 * 60 * 60;

export { SESSION_COOKIE };

function isSecureCookie() {
  return process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false';
}

export function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').map((part) => {
      const idx = part.indexOf('=');
      if (idx === -1) return [part.trim(), ''];
      const key = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      return [key, decodeURIComponent(value)];
    }),
  );
}

export function getSessionTokenFromRequest(req) {
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim();
  if (bearer) return bearer;
  const cookies = parseCookies(req);
  return cookies[SESSION_COOKIE] || null;
}

export function setSessionCookie(res, token) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_MAX_AGE_SEC}`,
  ];
  if (isSecureCookie()) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res) {
  const parts = [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (isSecureCookie()) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
