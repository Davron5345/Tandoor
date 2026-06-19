import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePermissionBundle,
  hasPermission,
} from '../permissions.js';

test('normalizePermissionBundle adds telegram.view for send permission', () => {
  const perms = normalizePermissionBundle(['telegram.send']);
  assert.ok(perms.includes('telegram.view'));
  assert.ok(perms.includes('telegram.send'));
});

test('cashier role has minimum cashier permissions', () => {
  assert.ok(hasPermission('cashier', 'cashier.view'));
  assert.ok(hasPermission('cashier', 'cashier.edit'));
  assert.ok(hasPermission('cashier', 'counterparties.view'));
});

test('admin role has wildcard access', () => {
  assert.ok(hasPermission('admin', 'documents.delete'));
  assert.ok(hasPermission('admin', 'telegram.send'));
});
