import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenApiSpec } from '../openapi.js';

test('buildOpenApiSpec includes core paths and security', () => {
  const spec = buildOpenApiSpec();
  assert.equal(spec.openapi, '3.0.3');
  assert.ok(spec.paths['/documents']);
  assert.ok(spec.paths['/products']);
  assert.ok(spec.paths['/admin/audit-log']);
  assert.ok(spec.components.securitySchemes.cookieAuth);
  assert.ok(spec.components.securitySchemes.bearerAuth);
  assert.ok(spec.tags.length >= 5);
});
