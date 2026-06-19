const isProd = process.env.NODE_ENV === 'production';

function parseAllowedOrigins() {
  const raw = process.env.CORS_ORIGIN || '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function isLocalDevOrigin(origin) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function getDeploymentOrigins() {
  const origins = [...parseAllowedOrigins()];
  const domain = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.APP_DOMAIN;
  if (domain) {
    const host = domain.replace(/^https?:\/\//, '');
    origins.push(`https://${host}`, `http://${host}`);
  }
  return [...new Set(origins)];
}

export function createCorsOptions() {
  const allowedOrigins = getDeploymentOrigins();

  return {
    origin(origin, callback) {
      if (!origin) return callback(null, true);

      if (!isProd) {
        if (isLocalDevOrigin(origin)) return callback(null, true);
        if (allowedOrigins.length === 0) return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) return callback(null, true);

      // Monolith: API и статика на одном домене (Railway, npm start).
      // Vite ставит crossorigin на JS/CSS — браузер шлёт Origin даже same-site.
      if (isProd && parseAllowedOrigins().length === 0) {
        return callback(null, origin);
      }

      callback(new Error('CORS: origin not allowed'));
    },
    credentials: true,
  };
}
