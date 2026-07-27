import test from 'node:test';
import assert from 'node:assert/strict';
import { isBankServiceFee, detectAcquiringChannelLabel } from '../services/bankStatementImport.js';

test('isBankServiceFee detects commission name', () => {
  assert.equal(isBankServiceFee({
    name: "Начисленные комиссионные ООО 'MAHALLA9O'",
    purpose: 'оп.обс(межбанк)-1120.00',
    account: '20208000900000000001',
    debit: 1120,
  }), true);
});

test('isBankServiceFee detects account 16401', () => {
  assert.equal(isBankServiceFee({
    name: 'SOME BANK',
    purpose: 'fee',
    account: '16401000900000000001',
    debit: 100,
  }), true);
});

test('isBankServiceFee ignores normal supplier payment', () => {
  assert.equal(isBankServiceFee({
    name: 'ООО Поставщик',
    purpose: 'Оплата по договору',
    account: '20208000900000000099',
    debit: 500000,
  }), false);
});

test('detectAcquiringChannelLabel: inkasso from name', () => {
  assert.equal(
    detectAcquiringChannelLabel('Инкассированная денежная выручка', '№8743791 · 00650Инк выручка'),
    'Инкассо',
  );
});

test('detectAcquiringChannelLabel: payme and terminal', () => {
  assert.equal(detectAcquiringChannelLabel('PAYME', 'Зачисление'), 'Payme');
  assert.equal(
    detectAcquiringChannelLabel('SmartVista', 'Выручка по торговому терминалу'),
    'Терминал',
  );
});

test('detectAcquiringChannelLabel: humo uzcard uzum', () => {
  assert.equal(detectAcquiringChannelLabel('OOO "MAHALLA90" HUMO', ''), 'Humo');
  assert.equal(detectAcquiringChannelLabel('OOO "MAHALLA90" UZCARD', ''), 'Uzcard');
  assert.equal(detectAcquiringChannelLabel('OOO "MAHALLA90" UZUM CARD', ''), 'Uzum Card');
});

test('pickCounterpartyInnFromName ignores purpose INN', async () => {
  const { pickCounterpartyInnFromName } = await import('../services/bankStatementImport.js');
  assert.equal(
    pickCounterpartyInnFromName('ООО Поставщик 309123456', new Set()),
    '309123456',
  );
  // ИНН только в «деталях» не должен браться — функция смотрит только name
  assert.equal(
    pickCounterpartyInnFromName('ООО Без ИНН', new Set()),
    null,
  );
});
