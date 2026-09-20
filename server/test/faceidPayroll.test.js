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

  const list = payroll.listPayrollEmployees('main');
  assert.equal(list.departments.length, 1);
  assert.equal(list.departments[0].name, 'Кухня');
  assert.equal(list.total_debt, 900000);
});
