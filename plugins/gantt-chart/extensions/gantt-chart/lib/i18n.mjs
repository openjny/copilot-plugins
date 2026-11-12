// Messages in the languages the chart speaks, shared by the extension (Node) and the page (browser).
// A message is a template with {name} placeholders. A message that depends on a number has one entry per plural
// category of the language: "key.one", "key.other" (English), and the plain "key" as the fallback.

import en from './locales/en.mjs';
import ja from './locales/ja.mjs';

export const LOCALES = Object.freeze(['ja', 'en']);
export const DEFAULT_LOCALE = 'en';
/** What a user may choose: one of the languages, or "auto" (follow the browser / OS). */
export const LOCALE_CHOICES = Object.freeze(['auto', ...LOCALES]);
export const CATALOGS = Object.freeze({ ja, en });

/** "ja-JP", "en_US", "ja" -> "ja" | "en"; anything else is the default language. */
export function resolveLocale(value) {
  const base = String(value ?? '').toLowerCase().split(/[-_]/)[0];
  return LOCALES.includes(base) ? base : DEFAULT_LOCALE;
}

let current = DEFAULT_LOCALE;

export const getLocale = () => current;

export function setLocale(value) {
  current = resolveLocale(value);
  return current;
}

const plurals = new Map();
const pluralCategory = (locale, count) => {
  if (!plurals.has(locale)) plurals.set(locale, new Intl.PluralRules(locale));
  return plurals.get(locale).select(count);
};

/** The message for `key` in the current language (or the default language, or the key itself), with {placeholders} filled in. */
export function t(key, params = {}) {
  const catalog = CATALOGS[current];
  let template;
  if (typeof params.count === 'number') template = catalog[`${key}.${pluralCategory(current, params.count)}`];
  template ??= catalog[key] ?? CATALOGS[DEFAULT_LOCALE][key] ?? key;
  return template.replace(/\{(\w+)\}/g, (whole, name) => (params[name] === undefined ? whole : String(params[name])));
}

/** The placeholders a message uses; the catalogs must agree on them. */
export const placeholdersOf = (template) => [...new Set([...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))].sort();
