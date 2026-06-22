import { login, logout, changePassword } from '../auth.js';
import { getRolesForBranch } from '../permissions.js';
import { attachBranch } from '../middleware.js';
import { canViewAllBranches } from '../branches.js';
import { loginRateLimit } from '../loginRateLimit.js';
import { isTelegramEnabled } from '../telegram.js';
import { setSessionCookie, clearSessionCookie } from '../sessionCookie.js';
import { logAudit } from '../auditLog.js';
import { logVisit } from '../visitLog.js';
import { extractRequestDevice } from '../deviceInfo.js';
import {
  listActiveSessions,
  getSessionById,
  revokeSessionById,
} from '../sessions.js';
import { buildOpenApiSpec, renderApiDocsHtml } from '../openapi.js';
import { getAppVersion } from '../appVersion.js';
import { isServerReady } from '../readiness.js';

export function registerAuthRoutes(app, { authRequired }) {
  app.get('/api/health', (_, res) => {
    const ready = isServerReady();
    res.status(200).json({
      ok: ready,
      ready,
      telegram: ready ? isTelegramEnabled() : false,
    });
  });

  app.get('/api/app-version', (_, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(getAppVersion());
  });

  app.get('/api/openapi.json', (_, res) => {
    res.json(buildOpenApiSpec());
  });

  app.get('/api/docs', (_, res) => {
    res.type('html').send(renderApiDocsHtml());
  });

  app.post('/api/auth/login', loginRateLimit, (req, res) => {
    const { username, password, remember } = req.body || {};
    try {
      const rememberSession = !!remember;
      const { token, user } = login(username, password, { remember: rememberSession, req });
      setSessionCookie(res, token, { remember: rememberSession });
      const device = extractRequestDevice(req);
      logAudit({ user, headers: req.headers, socket: req.socket }, 'auth.login', {
        meta: { username: user.username, device_label: device.deviceLabel, ip: device.ip },
      });
      logVisit(req, 'auth.login', { username: user.username, user_id: user.id, success: true });
      const wantsNativeToken = req.headers['x-native-client'] === '1' || !!req.body?.native;
      res.json(wantsNativeToken ? { user, token } : { user });
    } catch (e) {
      if (e.code === 'DEVICE_BLOCKED') {
        logVisit(req, 'auth.login_blocked', { username, success: false });
        return res.status(403).json({ error: e.message });
      }
      logVisit(req, 'auth.login_failed', { username, success: false });
      return res.status(401).json({ error: e.message });
    }
  });

  app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/public/')) {
      return next();
    }
    return authRequired(req, res, next);
  });

  app.get('/api/auth/me', (req, res) => {
    res.json(req.user);
  });

  app.get('/api/auth/sessions', (req, res) => {
    res.json(listActiveSessions({ user_id: req.user.id, ...req.query }, req.token));
  });

  app.delete('/api/auth/sessions/:id', (req, res) => {
    try {
      const session = getSessionById(req.params.id);
      if (!session || session.user_id !== req.user.id) {
        return res.status(404).json({ error: 'Сеанс не найден' });
      }
      if (session.token === req.token) {
        return res.status(400).json({ error: 'Нельзя завершить текущий сеанс. Используйте «Выйти».' });
      }
      revokeSessionById(req.params.id, req, { via: 'self' });
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
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
    logVisit(req, 'auth.logout', { success: true });
    logout(req.token);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.get('/api/auth/roles', authRequired, attachBranch, (req, res) => {
    const allBranches = canViewAllBranches(req.user, req.branchId);
    res.json(getRolesForBranch(req.branchId, { allBranches, includeAdmin: allBranches }));
  });
}
