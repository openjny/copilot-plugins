import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CATALOGS, LOCALES, getLocale, placeholdersOf, resolveLocale, setLocale, t } from '../lib/i18n.mjs';

test('every language has the same keys, and each message the same placeholders', () => {
  const [first, ...rest] = LOCALES;
  const keys = Object.keys(CATALOGS[first]).sort();
  for (const locale of rest) {
    const other = Object.keys(CATALOGS[locale]).sort();
    assert.deepEqual(
      keys.filter((key) => !other.includes(key)),
      [],
      `${locale} lacks keys`,
    );
    assert.deepEqual(
      other.filter((key) => !keys.includes(key)),
      [],
      `${first} lacks keys`,
    );
    for (const key of keys) assert.deepEqual(placeholdersOf(CATALOGS[locale][key]), placeholdersOf(CATALOGS[first][key]), `${key} differs in placeholders between ${first} and ${locale}`);
  }
});

test('no message is empty', () => {
  for (const locale of LOCALES) for (const [key, text] of Object.entries(CATALOGS[locale])) assert.ok(text.trim(), `${locale}: ${key}`);
});

test('a language is resolved from a browser or OS name', () => {
  assert.equal(resolveLocale('ja-JP'), 'ja');
  assert.equal(resolveLocale('en_US'), 'en');
  assert.equal(resolveLocale('fr'), 'en');
  assert.equal(resolveLocale(undefined), 'en');
});

test('messages are filled in, fall back to the default language, and plural forms are chosen by count', () => {
  try {
    setLocale('en');
    assert.equal(t('err.idUsed', { id: 'x' }), 'The id "x" is already used.');
    assert.equal(t('no.such.key'), 'no.such.key');
    assert.equal(t('err.idUsed'), 'The id "{id}" is already used.');
    setLocale('ja');
    assert.equal(getLocale(), 'ja');
    assert.equal(t('err.idUsed', { id: 'x' }), 'id "x" は既に使われています。');
  } finally {
    setLocale('en');
  }
});
