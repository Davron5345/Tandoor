/**
 * Проверка набора прав кассира и нормализации зависимостей.
 * Запуск: node server/scripts/verify-cashier-perms.mjs
 */
import db, { initDb } from '../db.js';
import {
  normalizePermissionBundle,
  getPermissionsForRole,
  matrixToPermissions,
  getRolePermissionsMatrix,
  PERMISSION_PRESETS,
  initPermissions,
} from '../permissions.js';

const CASHIER_REQUIRED = [
  'cashier.view',
  'cashier.edit',
  'cashier.delete',
  'counterparties.view',
];

await initDb();
initPermissions(db);

let failed = 0;

function ok(msg) {
  console.log(`  OK  ${msg}`);
}

function fail(msg) {
  console.error(` FAIL ${msg}`);
  failed += 1;
}

console.log('=== normalizePermissionBundle ===');
const partial = normalizePermissionBundle(['cashier.edit']);
if (partial.includes('cashier.view') && partial.includes('counterparties.view')) {
  ok('cashier.edit → cashier.view + counterparties.view');
} else {
  fail(`expected deps, got: ${partial.join(', ')}`);
}

console.log('\n=== preset cashier_work ===');
const preset = PERMISSION_PRESETS.find((p) => p.id === 'cashier_work');
const presetPerms = matrixToPermissions(preset.groups);
const normalizedPreset = normalizePermissionBundle(presetPerms);
for (const perm of CASHIER_REQUIRED) {
  if (normalizedPreset.includes(perm)) ok(`preset includes ${perm}`);
  else fail(`preset missing ${perm}`);
}

console.log('\n=== built-in cashier role ===');
const cashierPerms = getPermissionsForRole('cashier');
for (const perm of CASHIER_REQUIRED) {
  if (cashierPerms.includes(perm)) ok(`cashier role has ${perm}`);
  else fail(`cashier role missing ${perm}`);
}

console.log('\n=== custom roles with cashier access ===');
const rows = db.queryAll(`
  SELECT DISTINCT role FROM role_permissions
  WHERE permission IN ('cashier.edit', 'cashier.view', 'payments.edit')
`);
for (const { role } of rows) {
  if (role === 'admin') continue;
  const perms = getPermissionsForRole(role);
  const matrix = getRolePermissionsMatrix(role);
  const hasCashierWork = matrix.cashier?.write || matrix.cashier?.delete || perms.includes('payments.edit');
  if (!hasCashierWork) continue;
  if (!perms.includes('cashier.view') && !perms.includes('payments.view')) {
    fail(`${role}: no view permission for operations list`);
  } else if (matrix.cashier?.write && !perms.includes('counterparties.view')) {
    fail(`${role}: cashier.edit without counterparties.view`);
  } else if (matrix.cashier?.write) {
    ok(`${role}: cashier work bundle synced`);
  }
}

console.log(`\n${failed === 0 ? 'All checks passed.' : `${failed} check(s) failed.`}`);
process.exit(failed === 0 ? 0 : 1);
