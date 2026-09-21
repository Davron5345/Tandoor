import * as XLSX from 'xlsx';
import { getBranches, createBranch } from '../branches.js';
import { importPayrollEmployees } from './faceidPayroll.js';

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[''`´]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cellStr(value) {
  if (value == null) return '';
  return String(value).trim();
}

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 10); i += 1) {
    const row = rows[i] || [];
    const joined = row.map((c) => cellStr(c).toLowerCase()).join('|');
    if (joined.includes('фио') && (joined.includes('отдел') || joined.includes('должность') || joined.includes('фирма'))) {
      return i;
    }
  }
  return -1;
}

function colIndex(headerRow, names) {
  const wanted = names.map((n) => n.toLowerCase());
  for (let i = 0; i < headerRow.length; i += 1) {
    const h = cellStr(headerRow[i]).toLowerCase();
    if (wanted.includes(h)) return i;
  }
  return -1;
}

/**
 * Разбор Excel экспорта Face ID «Сотрудники» → строки для payroll_employees.
 * Ожидаемые колонки: Фирма, Отдел, Должность, ФИО, Табельный номер, Face ID, Оклад, Валюта, Активен.
 */
export function parseFaceIdEmployeesWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false, raw: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('В файле нет листов');
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '', raw: true });
  const headerIdx = findHeaderRow(rows);
  if (headerIdx < 0) {
    throw new Error('Не найден заголовок шаблона сотрудников (нужны колонки ФИО, Отдел / Должность / Фирма)');
  }
  const header = rows[headerIdx] || [];
  const idx = {
    firm: colIndex(header, ['Фирма', 'Объект']),
    department: colIndex(header, ['Отдел']),
    position: colIndex(header, ['Должность']),
    fullName: colIndex(header, ['ФИО']),
    tabNo: colIndex(header, ['Табельный номер']),
    faceId: colIndex(header, ['Face ID', 'FaceID', 'face_id']),
    salary: colIndex(header, ['Оклад']),
    currency: colIndex(header, ['Валюта']),
    active: colIndex(header, ['Активен']),
  };
  if (idx.fullName < 0) throw new Error('В файле нет колонки «ФИО»');

  const employees = [];
  for (let i = headerIdx + 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    if (!row.some((c) => cellStr(c))) continue;
    const fullName = cellStr(row[idx.fullName]);
    if (!fullName) continue;

    let salary = 0;
    if (idx.salary >= 0) {
      const raw = row[idx.salary];
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/\s/g, '').replace(',', '.'));
      salary = Number.isFinite(n) ? n : 0;
    }
    const currency = idx.currency >= 0 ? cellStr(row[idx.currency]).toUpperCase() : 'UZS';
    if (currency && currency !== 'UZS') salary = 0;

    const activeRaw = idx.active >= 0 ? cellStr(row[idx.active]) : 'Да';
    employees.push({
      firm: idx.firm >= 0 ? cellStr(row[idx.firm]) : '',
      department: idx.department >= 0 ? cellStr(row[idx.department]) : '',
      position: idx.position >= 0 ? cellStr(row[idx.position]) : '',
      full_name: fullName,
      tab_no: idx.tabNo >= 0 ? (cellStr(row[idx.tabNo]) || null) : null,
      faceid_id: idx.faceId >= 0 ? (cellStr(row[idx.faceId]) || null) : null,
      base_salary: salary,
      active: activeRaw !== 'Нет' && activeRaw !== '0' && activeRaw.toLowerCase() !== 'false',
    });
  }
  if (!employees.length) throw new Error('В файле нет строк сотрудников');
  return employees;
}

function findOrCreateBranch(firmName, { createMissing = true } = {}) {
  const branches = getBranches(false);
  const key = normalizeName(firmName || '');
  if (!key) return null;
  const existing = branches.find((b) => {
    const n = normalizeName(b.name);
    return n === key || n.includes(key) || key.includes(n);
  });
  if (existing) return { branch: existing, created: false };
  if (!createMissing) return null;
  const branch = createBranch({ name: firmName.trim(), active: true });
  return { branch, created: true };
}

/**
 * Импорт Excel: фирма → филиал (создаёт при отсутствии), upsert в payroll_employees.
 * @param {Buffer} buffer
 * @param {{ createMissingBranches?: boolean, onlyBranchId?: string|null }} options
 *   onlyBranchId — импортировать только строки, чья фирма совпала с этим филиалом
 *   (остальные пропускаются; если у строки фирма пустая — пишет в onlyBranchId).
 */
export function importPayrollEmployeesFromExcelBuffer(buffer, options = {}) {
  const createMissingBranches = options.createMissingBranches !== false;
  const onlyBranchId = options.onlyBranchId || null;
  const rows = parseFaceIdEmployeesWorkbook(buffer);

  const byFirm = new Map();
  for (const row of rows) {
    const firm = row.firm || '';
    if (!byFirm.has(firm)) byFirm.set(firm, []);
    byFirm.get(firm).push(row);
  }

  const branches = getBranches(false);
  const onlyBranch = onlyBranchId
    ? branches.find((b) => b.id === onlyBranchId)
    : null;

  const summary = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const [firm, employees] of byFirm) {
    let target = null;
    let branchCreated = false;

    if (onlyBranchId) {
      if (!firm) {
        target = onlyBranch;
      } else {
        const matched = findOrCreateBranch(firm, { createMissing: false });
        if (matched && matched.branch.id === onlyBranchId) {
          target = matched.branch;
        } else if (!matched && onlyBranch && normalizeName(onlyBranch.name) === normalizeName(firm)) {
          target = onlyBranch;
        } else if (!matched && firm && onlyBranch) {
          // фирма указана, но другого филиала нет — пишем в текущий, если имя похоже или фирма = объект филиала
          const nFirm = normalizeName(firm);
          const nBranch = normalizeName(onlyBranch.name);
          if (nFirm === nBranch || nBranch.includes(nFirm) || nFirm.includes(nBranch)) {
            target = onlyBranch;
          }
        }
      }
      if (!target) {
        skipped += employees.length;
        summary.push({
          firm: firm || '(пусто)',
          skipped: employees.length,
          reason: 'другой филиал',
        });
        continue;
      }
    } else {
      const resolved = findOrCreateBranch(firm || 'Без фирмы', { createMissing: createMissingBranches });
      if (!resolved) {
        skipped += employees.length;
        summary.push({ firm: firm || '(пусто)', skipped: employees.length, reason: 'филиал не найден' });
        continue;
      }
      target = resolved.branch;
      branchCreated = resolved.created;
    }

    const result = importPayrollEmployees(target.id, employees);
    created += result.created;
    updated += result.updated;
    skipped += result.skipped;
    summary.push({
      firm: firm || target.name,
      branch_id: target.id,
      branch_name: target.name,
      branch_created: branchCreated,
      ...result,
    });
  }

  return {
    total_rows: rows.length,
    created,
    updated,
    skipped,
    branches: summary,
  };
}
