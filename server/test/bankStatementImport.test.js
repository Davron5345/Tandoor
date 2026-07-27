import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseAccReferenceReportBuffer } from '../services/bankStatementImport.js';

const samplePath = '/Users/davron/Downloads/AccReferenceReport20260727142114.xlsx';

test('parse AccReferenceReport sample (Ipak Yuli)', { skip: !fs.existsSync(samplePath) }, () => {
  const buf = fs.readFileSync(samplePath);
  const { rows } = parseAccReferenceReportBuffer(buf);
  assert.ok(rows.length >= 30);
  const suppliers = rows.filter((r) => r.debit > 0 && !/комиссионн/i.test(r.name));
  assert.ok(suppliers.length >= 5);
  assert.ok(rows.some((r) => /CLICK/i.test(r.name) && r.credit > 0));
  assert.ok(rows.some((r) => /PAYME/i.test(r.purpose) && r.credit > 0));
  assert.equal(rows[0].date, '2026-07-27');
});

test('parse rejects non-statement workbook', () => {
  // minimal fake xlsx is hard; empty buffer should throw
  assert.throws(() => parseAccReferenceReportBuffer(Buffer.from('not-xlsx')), /./);
});
