import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  counterpartyInnLabel,
  counterpartyMatchesSearch,
  expandSearchTerms,
  splitTextBySearchHighlights,
  swapKeyboardLayout,
  textMatchesSearch,
} from '../../client/src/utils/searchNormalize.js';

test('swap keyboard layout fixes wrong layout typing', () => {
  assert.equal(swapKeyboardLayout('rbpbk', 'en_to_ru'), 'кизил');
  assert.equal(swapKeyboardLayout('йшяшд', 'ru_to_en'), 'qizil');
});

test('search matches cyrillic, latin and wrong layout', () => {
  const haystack = 'болгарский — кизил';

  assert.equal(textMatchesSearch(haystack, 'Кизил'), true);
  assert.equal(textMatchesSearch(haystack, 'Qizil'), true);
  assert.equal(textMatchesSearch(haystack, 'йшяшд'), true);
  assert.equal(textMatchesSearch(haystack, 'Rbpbk'), true);
  assert.equal(textMatchesSearch(haystack, 'Кук'), false);
});

test('expandSearchTerms includes transliteration variants', () => {
  const terms = expandSearchTerms('Qizil');
  assert.ok(terms.includes('qizil'));
  assert.ok(terms.some((t) => t.includes('к')));
});

test('splitTextBySearchHighlights marks all occurrences', () => {
  const parts = splitTextBySearchHighlights('Нон — Нон буханка', 'нон');
  const highlighted = parts.filter((p) => p.highlighted).map((p) => p.text);
  assert.deepEqual(highlighted, ['Нон', 'Нон']);
});

test('counterparty search matches name, INN and firm INN', () => {
  const item = {
    id: '1',
    name: 'Жалил',
    inn: null,
    firms_label: '308761740',
    firms: [{ name: 'ООО Жалил', inn: '308761740' }],
  };

  assert.equal(counterpartyMatchesSearch(item, 'жал'), true);
  assert.equal(counterpartyMatchesSearch(item, '308761740'), true);
  assert.equal(counterpartyMatchesSearch(item, '308 761 740'), true);
  assert.equal(counterpartyMatchesSearch(item, '30876'), true);
  assert.equal(counterpartyMatchesSearch(item, '999999999'), false);
  assert.equal(counterpartyInnLabel(item), '308761740');
});
