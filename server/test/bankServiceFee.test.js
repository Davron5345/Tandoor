import test from 'node:test';
import assert from 'node:assert/strict';
import { isBankServiceFee } from '../services/bankStatementImport.js';

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
