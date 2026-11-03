import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import {
  extractContractsFromPurpose,
  cleanPartyName,
  previewStatementRequisites,
  previewStatementRequisitesText,
} from '../services/statementRequisites.js';
import { parseAccReferenceReportText } from '../services/bankStatementImport.js';
import { initDb } from '../db.js';

const SAMPLE_TEXT = `
Internet Bank IPAK YULI
Справка о работе счета
Счет: 20208000707073001001 OOO "MAHALLA90"
Дата|Счет|N док-та|VO|МФО|Оборот Дебет|Оборот Кредит|Назначение платежа|ИНН
05.01.26|23508000007073001002|903|06|00444|0.00|182,634.00|ПК 2219UNIONPAY УЗКАРД|311330873
|OOO "MAHALLA90"-транзитный счет для инкассации||||||зачисление|
05.01.26|29896000804942713020|181|09|00401|0.00|500,000.00|ОПЛАТА ЗА ТОВАРЫ СОГ-НО ДОГ.№I-2308/U ОТ 2024-09-09 ЧЕРЕЗ CLICK|302134733
|"CLICK" AJ|||||||
05.01.26|20208000901234567890|100|01|00444|1,250,000.00|0.00|Оплата за мясо по договору №45/2024 от 12.03.2024|309876543
|ООО "ПОСТАВЩИК МЯСО"|||||||
05.01.26|20208000901234567890|101|01|00444|800,000.00|0.00|Доплата по дог. №45/2024 от 12.03.2024|309876543
|ООО "ПОСТАВЩИК МЯСО"|||||||
`.trim();

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

  const c = extractContractsFromPurpose('СОГ-НО ДОГ.№I-2308/U ОТ 2024-09-09 ЧЕРЕЗ CLICK');
  assert.equal(c.length, 1);
  assert.equal(c[0].number, 'I-2308/U');
  assert.equal(c[0].date, '2024-09-09');

  assert.deepEqual(extractContractsFromPurpose('без договора'), []);
});

test('parseAccReferenceReportText reads pipe Client Bank paste', () => {
  const { rows, meta } = parseAccReferenceReportText(SAMPLE_TEXT);
  assert.equal(meta.own_account, '20208000707073001001');
  assert.ok(rows.length >= 3);
  const supplier = rows.find((r) => r.innCol === '309876543');
  assert.ok(supplier);
  assert.match(supplier.name, /ПОСТАВЩИК/i);
  assert.equal(supplier.account, '20208000901234567890');
  assert.ok(supplier.debit > 0);
});

test('parseAccReferenceReportText accepts a single operation without header', () => {
  const one = [
    '12.03.26|20208000909988776655|55|01|00444|100.00|0.00|Оплата по дог. №9 от 01.01.2025|308112233',
    '|ООО ОДНА СТРОКА|||||||',
  ].join('\n');
  const { rows } = parseAccReferenceReportText(one);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].innCol, '308112233');
  assert.match(rows[0].name, /ОДНА СТРОКА/);
});

test('previewStatementRequisitesText dedupes and skips own/acquiring', async () => {
  await initDb();
  const preview = previewStatementRequisitesText(SAMPLE_TEXT, 'main');
  assert.equal(preview.format, 'AccReferenceReportText');
  assert.ok(preview.total >= 1);
  const supplier = preview.items.find((i) => i.inn === '309876543');
  assert.ok(supplier);
  assert.match(supplier.name, /ПОСТАВЩИК/i);
  assert.deepEqual(supplier.accounts, ['20208000901234567890']);
  assert.ok(supplier.contracts.some((c) => c.number === '45/2024'));
  assert.ok(!preview.items.some((i) => /CLICK/i.test(i.name)));
  assert.ok(!preview.items.some((i) => i.inn === '311330873'));
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
