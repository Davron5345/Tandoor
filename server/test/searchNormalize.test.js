import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  expandSearchTerms,
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
