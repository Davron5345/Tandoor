import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';
import db from '../db.js';
import { DEFAULT_BRANCH_ID, getBranch } from '../branches.js';
import { getSetting, setSetting } from './telegram.js';
import { createPayment } from './payments.js';
import { cashArticleId } from '../cashArticleDefaults.js';
import { getCashArticle } from '../cashArticles.js';

const { queryAll, queryOne, run, transaction } = db;

const SETTINGS_KEY = (branchId) => `faceid_config_${branchId || DEFAULT_BRANCH_ID}`;

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function generateViewToken() {
  return randomBytes(18).toString('base64url');
}

function uniquePayrollViewToken() {
  for (let i = 0; i < 8; i += 1) {
    const token = generateViewToken();
    const clashEmp = queryOne('SELECT id FROM payroll_employees WHERE view_token = ?', [token]);
    if (clashEmp) continue;
    const clashUser = queryOne('SELECT id FROM users WHERE login_token = ?', [token]);
    if (!clashUser) return token;
  }
  throw new Error('Не удалось выдать ссылку сотрудника');
}

function viewPathFor(token) {
  return token ? `/e/${encodeURIComponent(token)}` : null;
}

export function ensurePayrollViewTokens() {
  const rows = queryAll("SELECT id FROM payroll_employees WHERE view_token IS NULL OR view_token = ''");
  for (const row of rows) {
    run('UPDATE payroll_employees SET view_token = ? WHERE id = ?', [uniquePayrollViewToken(), row.id]);
  }
}

export function getFaceIdConfig(branchId = DEFAULT_BRANCH_ID) {
  const raw = getSetting(SETTINGS_KEY(branchId));
  let parsed = {};
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = {};
  }
  return {
    enabled: !!parsed.enabled,
    base_url: String(parsed.base_url || 'https://faceid.up.railway.app').replace(/\/$/, ''),
    device_key: String(parsed.device_key || ''),
    webhook_secret: String(parsed.webhook_secret || ''),
    last_sync_at: parsed.last_sync_at || null,
    last_attendance_sync_at: parsed.last_attendance_sync_at || null,
  };
}

export function saveFaceIdConfig(branchId, data = {}) {
  const prev = getFaceIdConfig(branchId);
  const next = {
    enabled: data.enabled !== undefined ? !!data.enabled : prev.enabled,
    base_url: (data.base_url !== undefined ? String(data.base_url) : prev.base_url).replace(/\/$/, ''),
    device_key: data.device_key !== undefined ? String(data.device_key || '') : prev.device_key,
    webhook_secret: data.webhook_secret !== undefined
      ? String(data.webhook_secret || '')
      : prev.webhook_secret,
    last_sync_at: prev.last_sync_at,
    last_attendance_sync_at: prev.last_attendance_sync_at,
  };
  if (!next.base_url) next.base_url = 'https://faceid.up.railway.app';
  setSetting(SETTINGS_KEY(branchId), JSON.stringify(next));
  return getFaceIdConfig(branchId);
}

function touchConfig(branchId, patch) {
  const cfg = getFaceIdConfig(branchId);
  setSetting(SETTINGS_KEY(branchId), JSON.stringify({ ...cfg, ...patch }));
}

async function faceIdFetch(branchId, path, options = {}) {
  const cfg = getFaceIdConfig(branchId);
  if (!cfg.device_key) throw new Error('Укажите X-Device-Key Face ID в настройках');
  const url = `${cfg.base_url}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Device-Key': cfg.device_key,
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = data?.error || data?.message || `Face ID HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function mapEmployeeRow(row, dayTimes = null) {
  if (!row) return null;
  const todayIn = dayTimes?.in_at || null;
  const todayOut = dayTimes?.out_at || null;
  return {
    id: row.id,
    branch_id: row.branch_id,
    faceid_id: row.faceid_id,
    tab_no: row.tab_no,
    full_name: row.full_name,
    department: row.department || '',
    position: row.position || '',
    active: !!row.active,
    balance: roundMoney(row.balance),
    base_salary: roundMoney(row.base_salary),
    last_event_type: row.last_event_type || null,
    last_event_at: row.last_event_at || null,
    today_in_at: todayIn,
    today_out_at: todayOut,
    present: row.last_event_type === 'in' || (!!todayIn && !todayOut),
    synced_at: row.synced_at || null,
    view_path: viewPathFor(row.view_token),
    has_login: !!row.has_login,
  };
}

/** Первая «вход» и последняя «выход» за календарный день YYYY-MM-DD. */
function attendanceDayMap(branchId, dateIso) {
  const day = String(dateIso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return new Map();
  const rows = queryAll(
    `SELECT employee_id, event_type, event_at
     FROM payroll_attendance
     WHERE branch_id = ?
       AND substr(event_at, 1, 10) = ?
     ORDER BY event_at ASC`,
    [branchId, day],
  );
  const map = new Map();
  for (const r of rows) {
    const cur = map.get(r.employee_id) || { in_at: null, out_at: null };
    if (r.event_type === 'in' && !cur.in_at) cur.in_at = r.event_at;
    if (r.event_type === 'out') cur.out_at = r.event_at;
    map.set(r.employee_id, cur);
  }
  return map;
}

export function listPayrollEmployees(branchId = DEFAULT_BRANCH_ID, { presentOnly = false, date = null } = {}) {
  ensurePayrollViewTokens();
  let rows = queryAll(
    `SELECT * FROM payroll_employees
     WHERE branch_id = ? AND active = 1
     ORDER BY department ASC, full_name ASC`,
    [branchId],
  );
  const day = String(date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const dayMap = attendanceDayMap(branchId, day);
  const linkedIds = new Set(
    queryAll(
      `SELECT payroll_employee_id AS id FROM users
       WHERE payroll_employee_id IS NOT NULL AND payroll_employee_id != '' AND active = 1`,
    ).map((r) => r.id),
  );
  if (presentOnly) {
    rows = rows.filter((r) => {
      const t = dayMap.get(r.id);
      if (t?.in_at || t?.out_at) return true;
      // fallback: последнее событие в этот же день
      const at = String(r.last_event_at || '').slice(0, 10);
      return at === day && (r.last_event_type === 'in' || r.last_event_type === 'out');
    });
  }
  const items = rows.map((r) => mapEmployeeRow({ ...r, has_login: linkedIds.has(r.id) }, dayMap.get(r.id)));
  const byDepartment = {};
  for (const emp of items) {
    const key = emp.department || 'Без отдела';
    if (!byDepartment[key]) byDepartment[key] = [];
    byDepartment[key].push(emp);
  }
  return {
    items,
    date: day,
    departments: Object.keys(byDepartment).sort((a, b) => a.localeCompare(b, 'ru')).map((name) => ({
      name,
      employees: byDepartment[name],
      debt_sum: roundMoney(byDepartment[name].reduce((s, e) => s + (e.balance || 0), 0)),
    })),
    total_debt: roundMoney(items.reduce((s, e) => s + (e.balance || 0), 0)),
  };
}

export function getPayrollEmployee(id, branchId = DEFAULT_BRANCH_ID) {
  const row = queryOne(
    'SELECT * FROM payroll_employees WHERE id = ? AND branch_id = ?',
    [id, branchId],
  );
  return mapEmployeeRow(row);
}

function upsertEmployeeFromFaceId(branchId, emp) {
  const faceidId = String(emp.id || emp.faceExternalId || emp.faceid_id || '').trim();
  const tabNo = emp.tabNo != null && String(emp.tabNo).trim()
    ? String(emp.tabNo).trim()
    : (emp.tab_no != null && String(emp.tab_no).trim() ? String(emp.tab_no).trim() : null);
  const fullName = String(emp.fullName || emp.full_name || [emp.lastName, emp.firstName, emp.middleName].filter(Boolean).join(' ') || '').trim();
  if (!fullName && !faceidId && !tabNo) return null;

  let existing = null;
  if (faceidId) {
    existing = queryOne(
      'SELECT * FROM payroll_employees WHERE branch_id = ? AND faceid_id = ?',
      [branchId, faceidId],
    );
  }
  if (!existing && tabNo) {
    existing = queryOne(
      'SELECT * FROM payroll_employees WHERE branch_id = ? AND tab_no = ?',
      [branchId, tabNo],
    );
  }
  if (!existing && fullName) {
    existing = queryOne(
      'SELECT * FROM payroll_employees WHERE branch_id = ? AND full_name = ? COLLATE NOCASE',
      [branchId, fullName],
    );
  }

  const department = emp.department || emp.departmentName || '';
  const position = emp.position || emp.positionName || '';
  const active = emp.active !== false && emp.active !== 0 && emp.active !== 'Нет';
  const now = new Date().toISOString();
  const hasSalary = emp.base_salary != null || emp.baseSalary != null || emp.salary != null;
  const baseSalary = hasSalary
    ? roundMoney(emp.base_salary ?? emp.baseSalary ?? emp.salary)
    : null;

  if (existing) {
    run(
      `UPDATE payroll_employees SET
        faceid_id = COALESCE(?, faceid_id),
        tab_no = COALESCE(?, tab_no),
        full_name = ?,
        department = ?,
        position = ?,
        active = ?,
        base_salary = COALESCE(?, base_salary),
        synced_at = ?
       WHERE id = ?`,
      [
        faceidId || null,
        tabNo,
        fullName || existing.full_name,
        department || existing.department || '',
        position || existing.position || '',
        active ? 1 : 0,
        baseSalary,
        now,
        existing.id,
      ],
    );
    return { id: existing.id, created: false };
  }

  const id = uuidv4();
  run(
    `INSERT INTO payroll_employees (
      id, branch_id, faceid_id, tab_no, full_name, department, position, active, balance, base_salary, synced_at, view_token
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [
      id,
      branchId,
      faceidId || null,
      tabNo,
      fullName || 'Без имени',
      department,
      position,
      active ? 1 : 0,
      baseSalary || 0,
      now,
      uniquePayrollViewToken(),
    ],
  );
  return { id, created: true };
}

/** Импорт сотрудников зарплаты (Excel/Face ID export → payroll_employees). */
export function importPayrollEmployees(branchId = DEFAULT_BRANCH_ID, employees = []) {
  if (!Array.isArray(employees) || !employees.length) {
    throw new Error('Нет сотрудников для импорта');
  }
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const raw of employees) {
    if (!raw || typeof raw !== 'object') {
      skipped += 1;
      continue;
    }
    const result = upsertEmployeeFromFaceId(branchId, {
      id: raw.faceid_id || raw.faceId || raw.employeeId || raw.id,
      tabNo: raw.tab_no || raw.tabNo,
      fullName: raw.full_name || raw.fullName || raw.fio,
      lastName: raw.last_name || raw.lastName || raw.фамилия,
      firstName: raw.first_name || raw.firstName || raw.имя,
      middleName: raw.middle_name || raw.middleName || raw.отчество,
      department: raw.department || raw.отдел,
      position: raw.position || raw.должность,
      base_salary: raw.base_salary ?? raw.baseSalary ?? raw.salary ?? raw.оклад,
      active: raw.active !== undefined
        ? raw.active
        : !(raw.активен === 'Нет' || raw.активен === false || raw.активен === 0),
    });
    if (!result) {
      skipped += 1;
      continue;
    }
    if (result.created) created += 1;
    else updated += 1;
  }
  touchConfig(branchId, { last_sync_at: new Date().toISOString() });
  return { created, updated, skipped, total: employees.length };
}

export async function syncFaceIdEmployees(branchId = DEFAULT_BRANCH_ID) {
  const list = await faceIdFetch(branchId, '/api/integration/employees');
  const rows = Array.isArray(list) ? list : (list?.items || list?.employees || []);
  let upserted = 0;
  for (const emp of rows) {
    if (upsertEmployeeFromFaceId(branchId, emp)) upserted += 1;
  }
  touchConfig(branchId, { last_sync_at: new Date().toISOString() });
  return { upserted, total: rows.length };
}

function findEmployeeForEvent(branchId, payload) {
  const faceidId = payload.employeeId || payload.employee_id || payload.faceid_id || null;
  const tabNo = payload.tabNo || payload.tab_no || null;
  const fullName = payload.fullName || payload.full_name || null;
  if (faceidId) {
    const byId = queryOne(
      'SELECT * FROM payroll_employees WHERE branch_id = ? AND faceid_id = ?',
      [branchId, String(faceidId)],
    );
    if (byId) return byId;
  }
  if (tabNo) {
    const byTab = queryOne(
      'SELECT * FROM payroll_employees WHERE branch_id = ? AND tab_no = ?',
      [branchId, String(tabNo)],
    );
    if (byTab) return byTab;
  }
  if (fullName) {
    return queryOne(
      'SELECT * FROM payroll_employees WHERE branch_id = ? AND full_name = ? COLLATE NOCASE',
      [branchId, String(fullName).trim()],
    );
  }
  return null;
}

function normalizeEventType(raw) {
  const t = String(raw || '').toLowerCase();
  if (['in', 'enter', 'arrival', 'приход', 'вход', 'checkin', 'check_in'].includes(t)) return 'in';
  if (['out', 'exit', 'leave', 'уход', 'выход', 'checkout', 'check_out'].includes(t)) return 'out';
  if (t === 'auto' || t === '') return null;
  return t === 'in' || t === 'out' ? t : null;
}

export function recordAttendanceEvent(branchId, payload = {}) {
  let eventType = normalizeEventType(payload.type || payload.event_type || payload.direction);
  const eventAt = payload.timestamp || payload.event_at || payload.at || new Date().toISOString();
  const externalId = payload.eventId || payload.external_id || payload.id || null;

  if (externalId) {
    const dup = queryOne(
      'SELECT id FROM payroll_attendance WHERE branch_id = ? AND external_id = ?',
      [branchId, String(externalId)],
    );
    if (dup) return { duplicate: true, id: dup.id };
  }

  let emp = findEmployeeForEvent(branchId, payload);
  if (!emp && (payload.employeeId || payload.fullName || payload.tabNo)) {
    const upserted = upsertEmployeeFromFaceId(branchId, {
      id: payload.employeeId,
      tabNo: payload.tabNo,
      fullName: payload.fullName,
      department: payload.department,
      position: payload.position,
      active: true,
    });
    emp = upserted
      ? queryOne('SELECT * FROM payroll_employees WHERE id = ?', [upserted.id])
      : null;
  }
  if (!emp) throw new Error('Сотрудник не найден. Сначала синхронизируйте сотрудников Face ID.');

  // AUTO: чередуем in/out по последнему событию
  if (!eventType) {
    eventType = emp.last_event_type === 'in' ? 'out' : 'in';
  }

  const id = uuidv4();
  run(
    `INSERT INTO payroll_attendance (
      id, branch_id, employee_id, event_type, event_at, external_id, source, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      branchId,
      emp.id,
      eventType,
      String(eventAt).slice(0, 30),
      externalId ? String(externalId) : null,
      payload.source || 'webhook',
      JSON.stringify(payload).slice(0, 4000),
    ],
  );
  run(
    `UPDATE payroll_employees SET last_event_type = ?, last_event_at = ? WHERE id = ?`,
    [eventType, String(eventAt).slice(0, 30), emp.id],
  );
  return {
    id,
    duplicate: false,
    employee: mapEmployeeRow(queryOne('SELECT * FROM payroll_employees WHERE id = ?', [emp.id])),
    event_type: eventType,
    event_at: eventAt,
  };
}

export async function syncFaceIdAttendance(branchId = DEFAULT_BRANCH_ID, { from, to } = {}) {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();
  const list = await faceIdFetch(branchId, `/api/integration/attendance${qs ? `?${qs}` : ''}`);
  const rows = Array.isArray(list) ? list : (list?.items || []);
  let imported = 0;
  let skipped = 0;
  for (const row of rows) {
    try {
      const result = recordAttendanceEvent(branchId, {
        employeeId: row.employeeId || row.employee_id,
        tabNo: row.tabNo,
        fullName: row.fullName,
        department: row.department,
        position: row.position,
        type: row.type || row.eventType || row.direction || (row.checkOut ? 'out' : 'in'),
        timestamp: row.timestamp || row.eventAt || row.at || row.date,
        eventId: row.id || row.eventId || row.external_ref,
        source: 'sync',
      });
      if (result.duplicate) skipped += 1;
      else imported += 1;
    } catch {
      skipped += 1;
    }
  }
  touchConfig(branchId, { last_attendance_sync_at: new Date().toISOString() });
  return { imported, skipped, total: rows.length };
}

export function verifyFaceIdWebhook(req, branchIdHint = null) {
  const key = req.headers['x-device-key'] || req.headers['x-faceid-key'] || req.body?.device_key;
  const secret = req.headers['x-webhook-secret'] || req.body?.webhook_secret;
  const branches = branchIdHint
    ? [{ id: branchIdHint }]
    : queryAll('SELECT id FROM branches');
  for (const b of (branches.length ? branches : [{ id: DEFAULT_BRANCH_ID }])) {
    const cfg = getFaceIdConfig(b.id);
    if (!cfg.enabled && !cfg.device_key && !cfg.webhook_secret) continue;
    if (cfg.webhook_secret && secret && secret === cfg.webhook_secret) {
      return b.id;
    }
    if (cfg.device_key && key && key === cfg.device_key) {
      return b.id;
    }
  }
  throw new Error('Неверный ключ интеграции Face ID');
}

function salaryArticleId(branchId) {
  const id = cashArticleId(branchId, 'exp_salary');
  const article = getCashArticle(id);
  if (!article) throw new Error('Статья кассы «Зарплата» не найдена');
  return id;
}

export function accruePayroll(employeeId, amount, {
  branchId = DEFAULT_BRANCH_ID,
  date = null,
  comment = '',
  userId = null,
} = {}) {
  const emp = queryOne(
    'SELECT * FROM payroll_employees WHERE id = ? AND branch_id = ?',
    [employeeId, branchId],
  );
  if (!emp) throw new Error('Сотрудник не найден');
  const value = roundMoney(amount);
  if (value <= 0) throw new Error('Сумма начисления должна быть больше нуля');

  let result;
  transaction(() => {
    const id = uuidv4();
    const nextBalance = roundMoney((Number(emp.balance) || 0) + value);
    run(
      `INSERT INTO payroll_ledger (
        id, branch_id, employee_id, entry_type, amount, balance_after, date, comment, created_by, payment_id
      ) VALUES (?, ?, ?, 'accrual', ?, ?, ?, ?, ?, NULL)`,
      [id, branchId, employeeId, value, nextBalance, (date || new Date().toISOString().slice(0, 10)), comment || 'Начисление зарплаты', userId],
    );
    run('UPDATE payroll_employees SET balance = ? WHERE id = ?', [nextBalance, employeeId]);
    result = {
      id,
      balance: nextBalance,
      employee: mapEmployeeRow(queryOne('SELECT * FROM payroll_employees WHERE id = ?', [employeeId])),
    };
  });
  return result;
}

export function payPayroll(employeeId, {
  branchId = DEFAULT_BRANCH_ID,
  pay_amount,
  accrue_amount = 0,
  date = null,
  comment = '',
  userId = null,
  userRole = null,
} = {}) {
  const emp = queryOne(
    'SELECT * FROM payroll_employees WHERE id = ? AND branch_id = ?',
    [employeeId, branchId],
  );
  if (!emp) throw new Error('Сотрудник не найден');

  const pay = roundMoney(pay_amount);
  const accrue = roundMoney(accrue_amount);
  if (pay <= 0) throw new Error('Укажите сумму выплаты больше нуля');
  if (accrue < 0) throw new Error('Начисление не может быть отрицательным');

  const day = (date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const articleId = salaryArticleId(branchId);

  let result;
  transaction(() => {
    let balance = roundMoney(emp.balance);
    let accrualId = null;

    if (accrue > 0) {
      balance = roundMoney(balance + accrue);
      accrualId = uuidv4();
      run(
        `INSERT INTO payroll_ledger (
          id, branch_id, employee_id, entry_type, amount, balance_after, date, comment, created_by, payment_id
        ) VALUES (?, ?, ?, 'accrual', ?, ?, ?, ?, ?, NULL)`,
        [accrualId, branchId, employeeId, accrue, balance, day, comment || 'Начисление зарплаты', userId],
      );
    }

    if (pay > balance + 1e-9) {
      throw new Error(`К выплате ${pay}, а долг (с начислением) только ${balance}`);
    }

    const payment = createPayment({
      type: 'other_expense',
      amount: pay,
      date: day,
      article_id: articleId,
      comment: `Зарплата: ${emp.full_name}${comment ? ` — ${comment}` : ''}`,
    }, userId, branchId, userRole);

    balance = roundMoney(balance - pay);
    const payoutId = uuidv4();
    run(
      `INSERT INTO payroll_ledger (
        id, branch_id, employee_id, entry_type, amount, balance_after, date, comment, created_by, payment_id
      ) VALUES (?, ?, ?, 'payout', ?, ?, ?, ?, ?, ?)`,
      [payoutId, branchId, employeeId, pay, balance, day, comment || 'Выплата зарплаты', userId, payment.id],
    );
    run('UPDATE payroll_employees SET balance = ? WHERE id = ?', [balance, employeeId]);

    result = {
      payment_id: payment.id,
      accrual_id: accrualId,
      payout_id: payoutId,
      paid: pay,
      accrued: accrue,
      balance,
      employee: mapEmployeeRow(queryOne('SELECT * FROM payroll_employees WHERE id = ?', [employeeId])),
    };
  });
  return result;
}

export function listPayrollLedger(employeeId, branchId = DEFAULT_BRANCH_ID, limit = 50) {
  const emp = getPayrollEmployee(employeeId, branchId);
  if (!emp) throw new Error('Сотрудник не найден');
  const rows = queryAll(
    `SELECT * FROM payroll_ledger
     WHERE employee_id = ? AND branch_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
    [employeeId, branchId, Math.min(200, Math.max(1, Number(limit) || 50))],
  );
  return {
    employee: emp,
    items: rows.map((r) => ({
      id: r.id,
      entry_type: r.entry_type,
      amount: roundMoney(r.amount),
      balance_after: roundMoney(r.balance_after),
      date: r.date,
      comment: r.comment || '',
      payment_id: r.payment_id || null,
      created_at: r.created_at,
    })),
  };
}

export function listRecentAttendance(branchId = DEFAULT_BRANCH_ID, limit = 30) {
  return queryAll(
    `SELECT a.*, e.full_name, e.department
     FROM payroll_attendance a
     JOIN payroll_employees e ON e.id = a.employee_id
     WHERE a.branch_id = ?
     ORDER BY a.event_at DESC, a.created_at DESC
     LIMIT ?`,
    [branchId, Math.min(100, Math.max(1, Number(limit) || 30))],
  ).map((r) => ({
    id: r.id,
    employee_id: r.employee_id,
    full_name: r.full_name,
    department: r.department,
    event_type: r.event_type,
    event_at: r.event_at,
    source: r.source,
  }));
}

export function rotatePayrollViewToken(employeeId, branchId = DEFAULT_BRANCH_ID) {
  const row = queryOne(
    'SELECT * FROM payroll_employees WHERE id = ? AND branch_id = ?',
    [employeeId, branchId],
  );
  if (!row) throw new Error('Сотрудник не найден');
  const token = uniquePayrollViewToken();
  run('UPDATE payroll_employees SET view_token = ? WHERE id = ?', [token, employeeId]);
  run('UPDATE users SET login_token = ? WHERE payroll_employee_id = ?', [token, employeeId]);
  return mapEmployeeRow(queryOne('SELECT * FROM payroll_employees WHERE id = ?', [employeeId]));
}

function localDayIso(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function findPayrollEmployeeForUser(user) {
  if (user?.payroll_employee_id) {
    const byId = queryOne(
      'SELECT * FROM payroll_employees WHERE id = ? AND active = 1',
      [user.payroll_employee_id],
    );
    if (byId) return byId;
  }
  const name = String(user?.name || '').trim();
  if (!name) return null;
  const params = [name];
  let sql = 'SELECT * FROM payroll_employees WHERE full_name = ? COLLATE NOCASE AND active = 1';
  if (user.branch_id) {
    sql += ' AND branch_id = ?';
    params.push(user.branch_id);
  }
  const matches = queryAll(sql, params);
  if (matches.length === 1) return matches[0];
  return null;
}

function buildPayrollCabinet(row) {
  const day = localDayIso();
  const month = day.slice(0, 7);
  const dayTimes = attendanceDayMap(row.branch_id, day).get(row.id) || {};
  const branch = getBranch(row.branch_id);

  const presentDays = queryAll(
    `SELECT DISTINCT substr(event_at, 1, 10) AS d
     FROM payroll_attendance
     WHERE employee_id = ? AND substr(event_at, 1, 7) = ?`,
    [row.id, month],
  ).length;
  const daysElapsed = Number(day.slice(8, 10)) || 1;
  const attendancePct = Math.min(100, Math.round((presentDays / daysElapsed) * 100));

  const ledger = queryAll(
    `SELECT entry_type, amount, balance_after, date, comment, created_at
     FROM payroll_ledger
     WHERE employee_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 30`,
    [row.id],
  ).map((r) => ({
    entry_type: r.entry_type,
    amount: roundMoney(r.amount),
    balance_after: roundMoney(r.balance_after),
    date: r.date,
    comment: r.comment || '',
    created_at: r.created_at,
  }));

  return {
    full_name: row.full_name,
    position: row.position || '',
    department: row.department || '',
    branch_name: branch?.name || '',
    balance: roundMoney(row.balance),
    base_salary: roundMoney(row.base_salary),
    today: {
      in_at: dayTimes.in_at || null,
      out_at: dayTimes.out_at || null,
    },
    month: {
      key: month,
      days_present: presentDays,
      days_elapsed: daysElapsed,
      rating: attendancePct,
    },
    ledger,
  };
}

export function getPayrollCabinetByToken(rawToken) {
  const token = String(rawToken || '').trim();
  if (!token || token.length < 16) {
    throw new Error('Ссылка недействительна');
  }
  const row = queryOne(
    'SELECT * FROM payroll_employees WHERE view_token = ? AND active = 1',
    [token],
  );
  if (!row) throw new Error('Ссылка недействительна или сотрудник отключён');
  return buildPayrollCabinet(row);
}

export function getPayrollCabinetForUser(user) {
  if (!user?.id) throw new Error('Требуется авторизация');
  const dbUser = queryOne('SELECT * FROM users WHERE id = ? AND active = 1', [user.id]);
  if (!dbUser) throw new Error('Пользователь не найден');
  const row = findPayrollEmployeeForUser(dbUser);
  if (!row) {
    throw new Error('Кабинет зарплаты не найден. Обратитесь к администратору.');
  }
  if (!dbUser.payroll_employee_id) {
    try {
      const taken = queryOne(
        'SELECT id FROM users WHERE payroll_employee_id = ? AND id != ?',
        [row.id, dbUser.id],
      );
      if (!taken) {
        run('UPDATE users SET payroll_employee_id = ? WHERE id = ?', [row.id, dbUser.id]);
      }
    } catch { /* колонка могла ещё не появиться */ }
  }
  return buildPayrollCabinet(row);
}
