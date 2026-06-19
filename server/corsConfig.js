const isProd = process.env.NODE_ENV === 'production';

function parseAllowedOrigins() {
  const raw = process.env.CORS_ORIGIN || '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function isLocalDevOrigin(origin) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

export function createCorsOptions() {
  const allowedOrigins = parseAllowedOrigins();

  return {
    origin(origin, callback) {
      if (!origin) return callback(null, true);

      if (!isProd) {
        if (isLocalDevOrigin(origin)) return callback(null, true);
        if (allowedOrigins.length === 0) return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) return callback(null, true);

      callback(new Error('CORS: origin not allowed'));
    },
    credentials: true,
  };
}
