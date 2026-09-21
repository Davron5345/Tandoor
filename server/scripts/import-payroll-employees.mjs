/**
 * Импорт сотрудников из Excel (экспорт Face ID) в payroll_employees.
 *
 * Фирма в файле → филиал по названию (создаёт филиал, если нет).
 *
 *   node server/scripts/import-payroll-employees.mjs /path/to/employees.xlsx
 *   node server/scripts/import-payroll-employees.mjs /path/to/employees.xlsx --dry-run
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { initDb } from '../db.js';
import {
  importPayrollEmployeesFromExcelBuffer,
  parseFaceIdEmployeesWorkbook,
} from '../services/payrollEmployeesImport.js';
import { getBranches } from '../branches.js';

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[''`´]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--dry-run');
  const dryRun = process.argv.includes('--dry-run');
  const filePath = resolve(args[0] || '');
  if (!args[0]) {
    console.error('Использование: node server/scripts/import-payroll-employees.mjs <employees.xlsx> [--dry-run]');
    process.exit(1);
  }

  await initDb();
  const buffer = readFileSync(filePath);
  const rows = parseFaceIdEmployeesWorkbook(buffer);
  console.log(`Строк в файле: ${rows.length}`);

  if (dryRun) {
    const byFirm = new Map();
    for (const row of rows) {
      const firm = row.firm || 'Без фирмы';
      byFirm.set(firm, (byFirm.get(firm) || 0) + 1);
    }
    const branches = getBranches(false);
    const summary = [...byFirm.entries()].map(([firm, count]) => {
      const key = normalizeName(firm);
      const branch = branches.find((b) => {
        const n = normalizeName(b.name);
        return n === key || n.includes(key) || key.includes(n);
      });
      return {
        firm,
        branch_id: branch?.id || `dry:${key}`,
        branch_name: branch?.name || firm,
        branch_created: !branch,
        employees: count,
        dry_run: true,
      };
    });
    console.log(JSON.stringify(summary, null, 2));
    console.log('(dry-run — в БД ничего не записано)');
    return;
  }

  const result = importPayrollEmployeesFromExcelBuffer(buffer, { createMissingBranches: true });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
