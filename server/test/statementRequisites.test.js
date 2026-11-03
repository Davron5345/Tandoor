import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import {
  extractContractsFromPurpose,
  cleanPartyName,
  previewStatementRequisites,
} from '../services/statementRequisites.js';
import { initDb } from '../db.js';

test('cleanPartyName strips INN from title', () => {
  assert.equal(cleanPartyName('ООО TEST 309876543', '309876543'), 'ООО TEST');
  assert.equal(cleanPartyName('  Firm  ', null), 'Firm');
});

test('extractContractsFromPurpose finds number and date', () => {
  const a = extractContractsFromPurpose('Оплата по договору №45/2024 от 12.03.2024 за товар');
  assert.equal(a.length, 1);
  assert.equal(a[0].number, '45/2024');
  assert.equal(a[0].date, '2024-03-12');

  const b = extractContractsFromPurpose('дог. N 12-А от 01.02.25; повтор дог. №12-А от 01.02.25');
  assert.equal(b.length, 1);
  assert.equal(b[0].number, '12-А');
  assert.equal(b[0].date, '2025-02-01');

  assert.deepEqual(extractContractsFromPurpose('без договора'), []);
});

const samplePath = '/Users/davron/Downloads/AccReferenceReport20261102144053.xlsx';

test('previewStatementRequisites dedupes by INN without amounts', {
  skip: !fs.existsSync(samplePath),
}, async () => {
  await initDb();
  const buf = fs.readFileSync(samplePath);
  const preview = previewStatementRequisites(buf, 'main');
  assert.ok(preview.total >= 1);
  assert.ok(preview.items.every((i) => i.name || i.inn));
  assert.ok(preview.items.every((i) => !('amount' in i) && !('debit' in i)));
  const inns = preview.items.map((i) => i.inn).filter(Boolean);
  assert.equal(inns.length, new Set(inns).size);
});
