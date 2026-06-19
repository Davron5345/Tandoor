import { hasPermission } from './permissions.js';
import { getUserByToken } from './auth.js';
import { resolveBranchId } from './branches.js';
import { getSessionTokenFromRequest } from './sessionCookie.js';

export function authOptional(req, res, next) {
  const token = getSessionTokenFromRequest(req);
  req.user = getUserByToken(token) || null;
  req.token = token || null;
  next();
}

export function authRequired(req, res, next) {
  authOptional(req, res, () => {
    if (!req.user) {
      return res.status(401).json({ error: 'Требуется авторизация' });
    }
    next();
  });
}

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Требуется авторизация' });
    }
    if (!hasPermission(req.user.role, permission)) {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }
    next();
  };
}

export function requireAnyPermission(...permissions) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Требуется авторизация' });
    }
    const allowed = permissions.some((p) => hasPermission(req.user.role, p));
    if (!allowed) {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }
    next();
  };
}

export function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Только администратор может выполнить это действие' });
  }
  next();
}

export function attachBranch(req, res, next) {
  try {
    const requested = req.query.branch_id || req.headers['x-branch-id'];
    req.branchId = resolveBranchId(req.user, requested);
    next();
  } catch (e) {
    res.status(403).json({ error: e.message });
  }
}