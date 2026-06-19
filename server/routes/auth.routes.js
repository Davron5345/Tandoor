import { login, logout, changePassword } from '../auth.js';
import { getRoles } from '../permissions.js';
import { loginRateLimit } from '../loginRateLimit.js';
import { isTelegramEnabled } from '../telegram.js';
import { setSessionCookie, clearSessionCookie } from '../sessionCookie.js';
import { logAudit } from '../auditLog.js';
import { buildOpenApiSpec, renderApiDocsHtml } from '../openapi.js';

export function registerAuthRoutes(app, { authRequired }) {
  app.get('/api/health', (_, res) => {
    res.json({ ok: true, telegram: isTelegramEnabled() });
  });

  app.get('/api/openapi.json', (_, res) => {
    res.json(buildOpenApiSpec());
  });

  app.get('/api/docs', (_, res) => {
    res.type('html').send(renderApiDocsHtml());
  });

  app.post('/api/auth/login', loginRateLimit, (req, res) => {
    try {
      const { username, password } = req.body;
      const { token, user } = login(username, password);
      setSessionCookie(res, token);
      logAudit({ user, headers: req.headers, socket: req.socket }, 'auth.login', {
        meta: { username: user.username },
      });
      res.json({ user });
    } catch (e) {
      res.status(401).json({ error: e.message });
    }
  });

  app.use('/api', authRequired);

  app.get('/api/auth/me', (req, res) => {
    res.json(req.user);
  });

  app.post('/api/auth/change-password', (req, res) => {
    try {
      const { current_password, new_password } = req.body || {};
      const user = changePassword(req.user.id, current_password, new_password, req.token);
      logAudit(req, 'auth.change_password');
      res.json({ ok: true, user });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    logAudit(req, 'auth.logout');
    logout(req.token);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.get('/api/auth/roles', (_, res) => {
    res.json(getRoles());
  });
}
