const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attempts = new Map();

function clientKey(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

export function loginRateLimit(req, res, next) {
  const key = clientKey(req);
  const now = Date.now();
  let entry = attempts.get(key);

  if (!entry || now - entry.start > WINDOW_MS) {
    entry = { start: now, count: 0 };
  }

  entry.count += 1;
  attempts.set(key, entry);

  if (entry.count > MAX_ATTEMPTS) {
    return res.status(429).json({
      error: 'Слишком много попыток входа. Повторите через 15 минут.',
    });
  }

  next();
}
