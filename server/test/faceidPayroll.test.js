import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir;

before(() => {
  testDir = mkdtempSync(join(tmpdir(), 'warehouse-payroll-'));
  process.env.DATA_DIR = testDir;
  process.env.DISABLE_DEMO_SEED = 'true';
  process.env.NODE_ENV = 'test';
  delete process.env.DATABASE_URL;
  delete process.env.DB_ENGINE;
});

after(() => {
  if (testDir) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

test('payroll accrue and partial pay accumulates debt', async () => {
  const { initDb } = await import('../db.js');
  await initDb();

  const { setSetting } = await import('../services/telegram.js');
  setSetting('faceid_config_main', JSON.stringify({
    enabled: true,
    base_url: 'https://faceid.up.railway.app',
    device_key: 'test-key',
    webhook_secret: 'wh-secret',
  }));

  const payroll = await import('../services/faceidPayroll.js');
  const imported = payroll.importPayrollEmployees('main', [
    {
      full_name: 'Тестов Тест',
      department: 'АУП',
      position: 'Кассир',
      base_salary: 1_000_000,
      active: true,
    },
  ]);
  assert.equal(imported.created, 1);
  const list = payroll.listPayrollEmployees('main');
  const found = list.items.find((e) => e.full_name === 'Тестов Тест');
  assert.ok(found);
  assert.equal(found.base_salary, 1_000_000);
  assert.equal(found.department, 'АУП');

  const empId = payroll.recordAttendanceEvent('main', {
    employeeId: 'face-1',
    tabNo: 'T1',
    fullName: 'Иванов Иван',
    department: 'Кухня',
    type: 'in',
    eventId: 'ev-1',
  }).employee.id;

  const accrued = payroll.accruePayroll(empId, 1000000, {
    branchId: 'main',
    date: '2026-09-20',
  });
  assert.equal(accrued.balance, 1000000);

  const paid = payroll.payPayroll(empId, {
    branchId: 'main',
    pay_amount: 400000,
    accrue_amount: 0,
    date: '2026-09-20',
    userRole: 'admin',
  });
  assert.equal(paid.paid, 400000);
  assert.equal(paid.balance, 600000);

  const again = payroll.payPayroll(empId, {
    branchId: 'main',
    pay_amount: 200000,
    accrue_amount: 500000,
    date: '2026-09-20',
    userRole: 'admin',
  });
  assert.equal(again.balance, 900000);

  const afterPay = payroll.listPayrollEmployees('main');
  assert.ok(afterPay.departments.some((d) => d.name === 'Кухня'));
  assert.equal(afterPay.total_debt, 900000);

  const cook = afterPay.items.find((e) => e.full_name === 'Иванов Иван');
  assert.ok(cook.view_path?.startsWith('/e/'));
  const token = cook.view_path.slice(3);
  const cabinet = payroll.getPayrollCabinetByToken(token);
  assert.equal(cabinet.full_name, 'Иванов Иван');
  assert.equal(cabinet.balance, 900000);

  const dbMod = await import('../db.js');
  dbMod.default.run(
    `INSERT INTO users (id, username, password_hash, name, role, active, branch_id, login_token)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    ['u-ivan', 'ivanov', 'x', 'Иванов Иван', 'cashier', 'main', 'tok-ivan-login-abcdefgh'],
  );
  const mine = payroll.getPayrollCabinetForUser({ id: 'u-ivan' });
  assert.equal(mine.full_name, 'Иванов Иван');
  assert.equal(mine.balance, 900000);

  const rotated = payroll.rotatePayrollViewToken(cook.id, 'main');
  assert.notEqual(rotated.view_path, cook.view_path);
  assert.throws(() => payroll.getPayrollCabinetByToken(token), /недействительна/);
});
