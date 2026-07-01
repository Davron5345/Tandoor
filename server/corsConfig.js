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

      // Monolith: API and static are served from one domain (Railway, npm start).
      // In production we allow same-origin requests only — do NOT reflect arbitrary origins.
      if (isProd && parseAllowedOrigins().length === 0) {
        const publicUrl = process.env.APP_PUBLIC_URL || process.env.RAILWAY_PUBLIC_DOMAIN;
        if (publicUrl) {
          const host = publicUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
          if (origin === `https://${host}` || origin === `http://${host}`) {
            return callback(null, true);
          }
        }
        // No configured origin — reject to avoid CSRF in production
        return callback(new Error('CORS: origin not allowed in production'));
      }

      callback(new Error('CORS: origin not allowed'));
    },
    credentials: true,
  };
}
