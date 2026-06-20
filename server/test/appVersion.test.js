import test from 'node:test';
import assert from 'node:assert/strict';
import { getAppVersion } from '../appVersion.js';

test('getAppVersion returns version string', () => {
  const data = getAppVersion();
  assert.equal(typeof data.version, 'string');
  assert.ok(data.version.length > 0);
});
