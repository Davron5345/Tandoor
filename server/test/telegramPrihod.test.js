import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  matchKey,
  matchTokens,
  parseDateLine,
  parsePrihodMessage,
  scoreTokens,
  splitPastedTelegramText,
} from '../telegramPrihodParser.js';

let testDir;

before(() => {
  testDir = mkdtempSync(join(tmpdir(), 'warehouse-tg-prihod-'));
  process.env.DATA_DIR = testDir;
  process.env.DISABLE_DEMO_SEED = 'true';
  process.env.NODE_ENV = 'test';
  process.env.TELEGRAM_ENABLED = 'false';
});

after(() => {
  if (testDir) rmSync(testDir, { recursive: true, force: true });
});

test('parser: supplier header with -дан, weights, pieces and Uzbek comma letters', () => {
  const a = parsePrihodMessage('Жалилдан:\nСон-45,8кг\nЖигар-4,3кг');
  assert.equal(a.groups.length, 1);
  assert.deepEqual(a.groups[0].supplier, { raw: 'Жалилдан', name: 'Жалил' });
  assert.deepEqual(a.groups[0].lines.map((l) => [l.name, l.quantity, l.unit]), [
    ['Сон', 45.8, 'кг'],
    ['Жигар', 4.3, 'кг'],
  ]);

  const b = parsePrihodMessage('Атхамдан:\nК,ўзи думбасиз -2та-26,2кг');
  const line = b.groups[0].lines[0];
  assert.equal(line.name, 'Қўзи думбасиз');
  assert.equal(line.quantity, 26.2);
  assert.equal(line.pieces, 2);

  const c = parsePrihodMessage('Контир-6,6кг\nВырезка -10,7кг');
  assert.equal(c.groups[0].supplier, null);
  assert.equal(c.groups[0].lines.length, 2);

  const d = parsePrihodMessage('Ассалому алейкум\nСон 500г');
  assert.deepEqual(d.notes, ['Ассалому алейкум']);
  assert.equal(d.groups[0].lines[0].quantity, 0.5);

  const multi = parsePrihodMessage('Жалилдан:\nСон-1кг\nМуротдан:\nКачалка -11кг');
  assert.equal(multi.groups.length, 2);
  assert.equal(multi.groups[1].supplier.name, 'Мурот');

  assert.equal(matchKey("Qo'zi dumbasiz"), matchKey('Қўзи думбасиз'));
});

test('parser: pasted Telegram history splits into dated messages', () => {
  const messages = splitPastedTelegramText(
    'Нодирбек, [09.10.2026 8:39]\nЖалилдан:\nСон-19,8кг\n\nНодирбек, [09.10.2026 12:14]\nМуротдан:\nКачалка -11кг',
  );
  assert.equal(messages.length, 2);
  assert.equal(messages[0].author, 'Нодирбек');
  assert.equal(messages[0].date, '2026-10-09');
  assert.equal(messages[0].time, '08:39');
  assert.ok(messages[1].text.startsWith('Муротдан:'));
});

test('topic messages become prihod drafts; unknown names wait for review and are remembered', async () => {
  const { default: db, initDb } = await import('../db.js');
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  const svc = await import('../services.js');
  const { getDefaultDepartmentId } = await import('../departments.js');
  const tp = await import('../services/telegramPrihod.js');

  await initDb();
  initPermissions(db);
  seedDefaultUsers();

  const deptId = getDefaultDepartmentId('main');
  const jalil = svc.createCounterparty({ name: 'Жалил', type: 'supplier', branch_id: 'main' });
  const son = svc.createProduct({ name: 'Сон', unit: 'кг', price: 0, branch_id: 'main', supplier_ids: [jalil.id] });
  svc.createProduct({ name: 'Жигар', unit: 'кг', price: 0, branch_id: 'main' });
  const lenta = svc.createProduct({ name: 'Говядина лента', unit: 'кг', price: 0, branch_id: 'main' });

  const msgBase = {
    chatId: -1001,
    threadId: 77,
    chatTitle: 'Махалла 90',
    topicTitle: 'Приход гушт',
    fromName: 'Нодирбек',
    date: new Date('2026-10-06T04:10:00Z'),
  };

  // Тема ещё не включена — сообщение только регистрирует тему
  const before = tp.handleIncomingMessage({ ...msgBase, messageId: 1, text: 'Жалилдан:\nСон-45,8кг' });
  assert.equal(before.results.length, 0);
  const topic = tp.listTopics('main').find((t) => t.chat_id === '-1001' && t.thread_id === '77');
  assert.ok(topic);
  assert.equal(topic.title, 'Приход гушт');
  tp.updateTopic(topic.id, { mode: 'prihod', department_id: deptId }, 'main');

  const ok = tp.handleIncomingMessage({ ...msgBase, messageId: 2, text: 'Жалилдан:\nСон-45,8кг\nЖигар-4,3кг' });
  assert.equal(ok.results.length, 1);
  assert.equal(ok.results[0].status, 'created');
  const doc = svc.getDocument(ok.results[0].document.id, 'main');
  assert.equal(doc.type, 'prihod');
  assert.equal(doc.status, 'draft');
  assert.equal(doc.date, '2026-10-06');
  assert.equal(doc.counterparty_id, jalil.id);
  assert.equal(doc.to_department_id, deptId);
  assert.deepEqual(doc.items.map((i) => Number(i.quantity)).sort(), [4.3, 45.8]);
  assert.match(doc.comment, /Нодирбек/);

  // Повторная доставка того же сообщения не дублирует
  const dup = tp.handleIncomingMessage({ ...msgBase, messageId: 2, text: 'Жалилдан:\nСон-45,8кг\nЖигар-4,3кг' });
  assert.equal(dup.results.length, 0);

  // Правка сообщения обновляет черновик
  const edited = tp.handleIncomingMessage({ ...msgBase, messageId: 2, edited: true, text: 'Жалилдан:\nСон-40кг\nЖигар-4,3кг' });
  assert.equal(edited.results[0].status, 'updated');
  const docAfterEdit = svc.getDocument(doc.id, 'main');
  assert.ok(docAfterEdit.items.some((i) => Number(i.quantity) === 40 && i.product_id === son.id));

  // «Лента» не совпадает однозначно, поставщика нет в справочнике — ждёт проверки
  const pending = tp.handleIncomingMessage({ ...msgBase, messageId: 3, text: 'Рустамдан:\nЛента-13кг' });
  assert.equal(pending.results[0].status, 'pending');
  assert.match(pending.results[0].reply, /Рустам/);

  const { items, counts } = tp.listInbox('main', { status: 'pending' });
  assert.equal(counts.created, 1);
  const entry = items.find((i) => i.message_id === '3');
  assert.ok(entry);
  assert.equal(entry.analysis.ready, false);
  assert.equal(entry.analysis.supplier.counterparty_id, null);
  assert.ok(entry.analysis.lines[0].suggestions.some((s) => s.product_id === lenta.id));

  const rustam = svc.createCounterparty({ name: 'Рустам ака', type: 'supplier', branch_id: 'main' });
  const created = tp.createFromInbox(entry.id, {
    counterparty_id: rustam.id,
    date: entry.doc_date,
    items: [{ line_index: 0, product_id: lenta.id, quantity: 13, price: 90000 }],
  }, 'test-user', 'main');
  assert.equal(created.document.status, 'draft');
  assert.equal(Number(created.document.total_amount), 13 * 90000);
  svc.confirmDocument(created.document.id, 'test-user');

  // Сопоставление запомнено: следующее такое сообщение создаётся само, цена — из проведённого прихода
  const learned = tp.handleIncomingMessage({ ...msgBase, messageId: 4, text: 'Рустамдан:\nЛента-10кг' });
  assert.equal(learned.results[0].status, 'created');
  const learnedDoc = svc.getDocument(learned.results[0].document.id, 'main');
  assert.equal(learnedDoc.counterparty_id, rustam.id);
  assert.equal(learnedDoc.items[0].product_id, lenta.id);
  assert.equal(Number(learnedDoc.items[0].price), 90000);

  // Удаление прихода возвращает сообщение во входящие
  svc.deleteDocument(learnedDoc.id);
  const back = tp.listInbox('main', { status: 'new' }).items.find((i) => i.message_id === '4');
  assert.ok(back);
  assert.equal(back.document_id, null);
});

test('pasted history imports once and ready messages create drafts in bulk', async () => {
  const svc = await import('../services.js');
  const { getDefaultDepartmentId } = await import('../departments.js');
  const tp = await import('../services/telegramPrihod.js');
  const deptId = getDefaultDepartmentId('main');

  const text = 'Нодирбек, [07.10.2026 8:31]\nЖалилдан:\nСон -20кг\n\nНодирбек, [08.10.2026 11:45]\nКонтир-6,6кг';
  const first = tp.importPastedText('main', { text, department_id: deptId });
  assert.equal(first.added, 2);
  const again = tp.importPastedText('main', { text, department_id: deptId });
  assert.equal(again.added, 0);
  assert.equal(again.duplicates, 2);

  const bulk = tp.createReadyFromInbox('main', 'test-user');
  assert.equal(bulk.created.length, 2);
  const doc = svc.getDocument(bulk.created.find((c) => c.number).document_id, 'main');
  assert.equal(doc.type, 'prihod');
  const dates = bulk.created.map((c) => svc.getDocument(c.document_id, 'main').date).sort();
  assert.ok(dates.includes('2026-10-07'));

  const noSupplier = tp.listInbox('main', { status: 'pending' }).items.find((i) => i.source === 'paste');
  assert.ok(noSupplier, 'message without supplier stays for review');
  assert.equal(noSupplier.analysis.supplier, null);
});

test('matching: Latin and Cyrillic spellings, suffixes and small typos are the same word', () => {
  const score = (q, c) => scoreTokens(matchTokens(q), matchTokens(c));
  assert.ok(score('Жалил', 'Jalil aka') >= 70);
  assert.ok(score('Мурот', 'Murod') >= 70);
  assert.ok(score('Сон', 'Mol soni') >= 70);
  assert.ok(score('Жигар', 'Jigari') >= 70);
  assert.ok(score('Jigar', 'Жигар') >= 90);
  assert.ok(score('Qo\'zi dumbasiz', 'Қўзи думбасиз') >= 90);
  assert.ok(score('Вырезка', 'Virezka') >= 90);
  assert.ok(score('Маталашка', 'Matalashka') >= 90);
  assert.equal(score('Сон', 'Молоко'), 0);
  assert.equal(score('Мол', 'Молоко'), 0);
  assert.ok(score('Куй жигари', 'Жигар') < 25);
});

test('parser: a date written in the message is skipped (document date comes from Telegram)', () => {
  assert.deepEqual(parseDateLine('06.10', '2026-10-08'), { date: '2026-10-06', rest: '' });
  assert.deepEqual(parseDateLine('Сана: 6.10.2026', null), { date: '2026-10-06', rest: '' });
  assert.equal(parseDateLine('28.12', '2027-01-03').date, '2026-12-28');
  assert.equal(parseDateLine('06.10 Жалилдан:', '2026-10-08').rest, 'Жалилдан:');
  assert.equal(parseDateLine('Сон 4.5 кг', '2026-10-08'), null);
  assert.equal(parseDateLine('31.02', '2026-10-08'), null);

  const p = parsePrihodMessage('06.10\nЖалилдан:\nСон-4.5кг\n07.10 Муротдан:\nКачалка -11кг');
  assert.deepEqual(p.groups.map((g) => g.supplier.name), ['Жалил', 'Мурот']);
  assert.equal(p.groups[0].lines[0].quantity, 4.5);
  assert.deepEqual(p.notes, []);
});

test('Telegram date, then supplier, then the supplier\'s own products; product keywords', async () => {
  const svc = await import('../services.js');
  const tp = await import('../services/telegramPrihod.js');

  const anvar = svc.createCounterparty({ name: 'Anvar', type: 'supplier', branch_id: 'main' });
  const bobur = svc.createCounterparty({ name: 'Бобур', type: 'supplier', branch_id: 'main' });
  const toshMol = svc.createProduct({ name: 'Тўш мол', unit: 'кг', price: 0, branch_id: 'main', supplier_ids: [anvar.id] });
  const toshQoy = svc.createProduct({ name: "To'sh qo'y", unit: 'кг', price: 0, branch_id: 'main', supplier_ids: [bobur.id] });
  const sarpanja = svc.createProduct({
    name: 'Сарпанжа', unit: 'кг', price: 0, branch_id: 'main', keywords: 'Ковурга,  корейка; Ковурга',
  });
  assert.equal(sarpanja.keywords, 'Ковурга, корейка');

  const base = { chatId: -1001, threadId: 77, fromName: 'Нодирбек', date: new Date('2026-10-08T05:00:00Z') };
  const a = tp.handleIncomingMessage({ ...base, messageId: 60, text: '06.10\nАнвардан:\nТўш-5кг\nКорейка-3кг' });
  assert.equal(a.results[0].status, 'created');
  const docA = svc.getDocument(a.results[0].document.id, 'main');
  assert.equal(docA.date, '2026-10-08');
  assert.equal(docA.counterparty_id, anvar.id);
  assert.deepEqual(docA.items.map((i) => i.product_id).sort(), [toshMol.id, sarpanja.id].sort());

  const b = tp.handleIncomingMessage({ ...base, messageId: 61, text: 'Бобурдан:\nТўш-7кг' });
  const docB = svc.getDocument(b.results[0].document.id, 'main');
  assert.equal(docB.date, '2026-10-08');
  assert.equal(docB.items[0].product_id, toshQoy.id);

  // Без поставщика «Тўш» неоднозначен — ждёт выбора
  const c = tp.handleIncomingMessage({ ...base, messageId: 62, text: 'Тўш-1кг' });
  assert.equal(c.results[0].status, 'pending');
});

test('Latin catalog names are recognised from a Cyrillic topic message', async () => {
  const svc = await import('../services.js');
  const tp = await import('../services/telegramPrihod.js');

  const murod = svc.createCounterparty({ name: 'Murod aka', type: 'supplier', branch_id: 'main' });
  const jigari = svc.createProduct({ name: "Qo'y jigari", unit: 'кг', price: 0, branch_id: 'main' });
  const matal = svc.createProduct({ name: 'Matalashka', unit: 'кг', price: 0, branch_id: 'main' });

  const res = tp.handleIncomingMessage({
    chatId: -1001,
    threadId: 77,
    messageId: 50,
    fromName: 'Нодирбек',
    date: new Date('2026-10-10T05:00:00Z'),
    text: 'Муротдан:\nКуй жигари-3кг\nМаталашка -51,8кг',
  });
  assert.equal(res.results[0].status, 'created');
  const doc = svc.getDocument(res.results[0].document.id, 'main');
  assert.equal(doc.counterparty_id, murod.id);
  assert.deepEqual(
    doc.items.map((i) => i.product_id).sort(),
    [jigari.id, matal.id].sort(),
  );
});

test('review window adds a missing variant to the product and remembers it', async () => {
  const { default: db } = await import('../db.js');
  const svc = await import('../services.js');
  const tp = await import('../services/telegramPrihod.js');

  const atxam = svc.createCounterparty({ name: "Qo'y (Atxam)", type: 'supplier', branch_id: 'main' });
  const qoy = svc.createProduct({
    name: "Qo'y", unit: 'кг', branch_id: 'main', has_variants: true,
    variants: [{ name: 'Butun (Vaguri)', price: 160000 }],
  });
  const butunId = qoy.variants[0].id;

  const base = { chatId: -1001, threadId: 77, fromName: 'Нодирбек', date: new Date('2026-10-07T05:00:00Z') };
  const first = tp.handleIncomingMessage({ ...base, messageId: 70, text: 'Атхамдан:\nК,ўзи думбасиз -2та-26,2кг' });
  const entry = first.results[0].entry;

  const created = tp.createFromInbox(entry.id, {
    counterparty_id: atxam.id,
    items: [{ line_index: 0, product_id: qoy.id, new_variant_name: 'Қўзи думбасиз', quantity: 26.2, price: 160000 }],
  }, 'test-user', 'main');
  const variants = db.queryAll('SELECT id, name, stock FROM product_variants WHERE product_id = ? ORDER BY sort_order', [qoy.id]);
  assert.deepEqual(variants.map((v) => v.name), ['Butun (Vaguri)', 'Қўзи думбасиз']);
  const newVariant = variants[1];
  assert.equal(created.document.items[0].variant_id, newVariant.id);
  assert.notEqual(newVariant.id, butunId);

  // Тот же вариант второй раз не создаётся, следующее сообщение приходуется на него само
  const again = tp.handleIncomingMessage({ ...base, messageId: 71, text: 'Атхамдан:\nК,ўзи думбасиз -1та-12кг' });
  assert.equal(again.results[0].status, 'created');
  const doc = svc.getDocument(again.results[0].document.id, 'main');
  assert.equal(doc.items[0].variant_id, newVariant.id);
  assert.equal(db.queryAll('SELECT id FROM product_variants WHERE product_id = ?', [qoy.id]).length, 2);

  const { addProductVariant } = await import('../services/products.js');
  const plain = svc.createProduct({ name: 'Bez variantov', unit: 'кг', price: 0, branch_id: 'main' });
  assert.throws(() => addProductVariant(plain.id, 'X', 'main'), /нет вариантов/);
});
