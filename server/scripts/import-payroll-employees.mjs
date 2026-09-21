/**
 * Импорт сотрудников из Excel (экспорт Face ID) в payroll_employees.
 *
 * Фирма в файле → филиал по названию (создаёт филиал, если нет).
 *
 *   node server/scripts/import-payroll-employees.mjs /path/to/employees.xlsx
 *   node server/scripts/import-payroll-employees.mjs /path/to/employees.xlsx --dry-run
 */
import { spawnSync } from 'child_process';
import { resolve } from 'path';
import { initDb } from '../db.js';
import { getBranches, createBranch } from '../branches.js';
import { importPayrollEmployees } from '../services/faceidPayroll.js';

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[''`´]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseExcelViaPython(filePath) {
  const py = `
import json, zipfile, xml.etree.ElementTree as ET, sys
from pathlib import Path
path = Path(sys.argv[1])
ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(path) as z:
    ss = []
    if 'xl/sharedStrings.xml' in z.namelist():
        root = ET.fromstring(z.read('xl/sharedStrings.xml'))
        for si in root.findall('m:si', ns):
            texts = [t.text or '' for t in si.iter('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t')]
            ss.append(''.join(texts))
    sheet = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
    rows = []
    for row in sheet.findall('m:sheetData/m:row', ns):
        vals = []
        for c in row.findall('m:c', ns):
            t = c.get('t')
            v = c.find('m:v', ns)
            if v is None:
                vals.append('')
                continue
            if t == 's':
                vals.append(ss[int(v.text)])
            else:
                vals.append(v.text or '')
        rows.append(vals)
header = rows[1]
idx = {h: i for i, h in enumerate(header)}
out = []
for r in rows[2:]:
    if not any(str(x).strip() for x in r):
        continue
    def cell(name):
        i = idx.get(name)
        return (r[i] if i is not None and i < len(r) else '') or ''
    salary_raw = str(cell('Оклад')).strip()
    try:
        salary = float(salary_raw) if salary_raw else 0
    except ValueError:
        salary = 0
    currency = str(cell('Валюта')).strip().upper()
    # в зарплате кассы суммы в сумах — USD не подставляем как оклад смены
    if currency and currency != 'UZS':
        salary = 0
    out.append({
        'firm': str(cell('Фирма')).strip(),
        'department': str(cell('Отдел')).strip(),
        'position': str(cell('Должность')).strip(),
        'full_name': str(cell('ФИО')).strip(),
        'tab_no': str(cell('Табельный номер')).strip() or None,
        'faceid_id': str(cell('Face ID')).strip() or None,
        'base_salary': salary,
        'active': str(cell('Активен')).strip() != 'Нет',
    })
print(json.dumps(out, ensure_ascii=False))
`;
  const result = spawnSync('python3', ['-c', py, filePath], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'Не удалось разобрать Excel');
  }
  return JSON.parse(result.stdout);
}

function findOrCreateBranch(firmName, dryRun) {
  const branches = getBranches(false);
  const key = normalizeName(firmName);
  let branch = branches.find((b) => {
    const n = normalizeName(b.name);
    return n === key || n.includes(key) || key.includes(n);
  });
  if (branch) return { branch, created: false };
  if (dryRun) {
    return { branch: { id: `dry:${key}`, name: firmName }, created: true };
  }
  branch = createBranch({ name: firmName, active: true });
  return { branch, created: true };
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
  const rows = parseExcelViaPython(filePath);
  console.log(`Строк в файле: ${rows.length}`);

  const byFirm = new Map();
  for (const row of rows) {
    const firm = row.firm || 'Без фирмы';
    if (!byFirm.has(firm)) byFirm.set(firm, []);
    byFirm.get(firm).push(row);
  }

  const summary = [];
  for (const [firm, employees] of byFirm) {
    const { branch, created: branchCreated } = findOrCreateBranch(firm, dryRun);
    if (dryRun) {
      summary.push({
        firm,
        branch_id: branch.id,
        branch_name: branch.name,
        branch_created: branchCreated,
        employees: employees.length,
        dry_run: true,
      });
      continue;
    }
    const result = importPayrollEmployees(branch.id, employees);
    summary.push({
      firm,
      branch_id: branch.id,
      branch_name: branch.name,
      branch_created: branchCreated,
      ...result,
    });
  }

  console.log(JSON.stringify(summary, null, 2));
  if (dryRun) console.log('(dry-run — в БД ничего не записано)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
