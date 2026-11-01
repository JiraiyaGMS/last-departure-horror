// The language the game speaks, and the one function that says things in it.
//
// The English is written in the code itself, and it is the key: t('Read')
// looks 'Read' up in the chosen language's dictionary (src/lang/) and falls
// back to the English if it is not there. `{name}` in a string is filled from
// `params`: t('Fresh cell in ({n} spare)', { n: 2 }).
//
// The language is chosen once, as the page loads: ?lang= in the address, then
// the player's own choice (kept with the settings), then the browser's own
// language. Changing it reloads the page: the signs in the station are
// painted once, and the save already holds everything worth keeping.
//
// The notebook is saved in English whatever the language, and translated as
// it is shown (tNote), so a notebook survives a change of language and an
// entry is never written down twice in two languages.

import PT, { PT_PATTERNS } from './lang/pt/index.js';

export const LANGUAGES = {
  en: { label: 'ENGLISH', html: 'en' },
  pt: { label: 'PORTUGUÊS', html: 'pt-BR' },
};

const DICTS = { pt: { words: PT, patterns: PT_PATTERNS } };

// Shared with settings.js, which keeps the player's choice.
const SETTINGS_KEY = 'lastDeparture.settings';

function choose() {
  try {
    const asked = new URLSearchParams(window.location.search).get('lang');
    if (asked && LANGUAGES[asked]) return asked;
  } catch {
    // No address to read.
  }
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}').lang;
    if (LANGUAGES[saved]) return saved;
  } catch {
    // Unreadable or blocked storage: go by the browser.
  }
  const prefs = navigator.languages?.length ? navigator.languages : [navigator.language || 'en'];
  for (const tag of prefs) {
    const base = String(tag).toLowerCase().split('-')[0];
    if (LANGUAGES[base]) return base;
  }
  return 'en';
}

export const LANG = choose();

const dict = DICTS[LANG] ?? null;
const words = dict ? new Map(Object.entries(dict.words)) : null;
// The same words with the case folded, for text that was lower-cased on the
// way into a sentence before it was saved.
let folded = null;

// Keys asked for and not found, for anyone checking the translation (and the
// console in development).
const missing = new Set();
if (typeof window !== 'undefined') window.__i18nMissing = missing;

function fill(s, params) {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m));
}

function lookup(key) {
  if (!words || key == null || key === '') return key;
  const hit = words.get(key);
  if (hit !== undefined) return hit;
  if (!missing.has(key)) {
    missing.add(key);
    if (import.meta.env?.DEV) console.warn(`[i18n:${LANG}] no translation for`, JSON.stringify(key));
  }
  return key;
}

// Says `key` in the game's language.
export function t(key, params) {
  return fill(lookup(key), params);
}

// Marks a string for translation where it is defined, and leaves it in
// English: for text the game also uses as a name for something (a rule's
// wording, a board status, a zone), which is translated where it is shown.
export function msg(key) {
  return key;
}

// Like t(), but forgiving of case: for a phrase that was lower-cased into a
// sentence before it was saved. Keeps the case it was given.
export function tLoose(key) {
  if (!words) return key;
  if (words.has(key)) return words.get(key);
  if (!folded) {
    folded = new Map();
    for (const [k, v] of words) folded.set(k.toLowerCase(), v);
  }
  const hit = folded.get(String(key).toLowerCase());
  if (hit === undefined) return lookup(key);
  return key === key.toLowerCase() ? lowerFirst(hit) : hit;
}

export function lowerFirst(s) {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

// A notebook entry, saved in English, in the game's language. Most are a
// plain lookup; the few with a name or a number in them are matched by
// pattern (see the dictionary's PATTERNS).
export function tNote(text) {
  if (!words) return text;
  if (words.has(text)) return words.get(text);
  for (const [re, make] of dict.patterns ?? []) {
    const m = re.exec(text);
    if (m) return make(m, { t, tLoose });
  }
  return lookup(text);
}

// "A hatbox, crushed on one side" -> "the hatbox, crushed on one side", in
// the game's language. `short` drops everything after the first comma.
export function theItem(item, short = false) {
  let s = t(item);
  if (short) s = s.split(',')[0];
  if (LANG === 'pt') {
    // Um/uma -> o/a. Everything else about the phrase stays as written.
    return s.replace(/^uma /i, 'a ').replace(/^um /i, 'o ').replace(/^(\S)/, (c) => c.toLowerCase());
  }
  return `the ${s.replace(/^an? /i, '')}`.toLowerCase();
}

// Every element in the page marked `data-t` gets its text in the game's
// language; `data-t-html` translates the markup inside it, and
// `data-t-aria` an aria-label. The English in the page is the key.
export function translatePage(root = document) {
  document.documentElement.lang = LANGUAGES[LANG].html;
  if (!words) return;
  // Anything without a translation keeps its English rather than its key.
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  for (const el of root.querySelectorAll('[data-t]')) {
    const key = el.dataset.t || norm(el.textContent);
    if (lookup(key) !== key) el.textContent = lookup(key);
  }
  for (const el of root.querySelectorAll('[data-t-html]')) {
    const key = el.dataset.tHtml || norm(el.innerHTML);
    if (lookup(key) !== key) el.innerHTML = lookup(key);
  }
  for (const el of root.querySelectorAll('[data-t-aria]')) {
    el.setAttribute('aria-label', t(el.getAttribute('aria-label')));
  }
}

// Switches the game to another language: kept with the settings, then the
// page reloads in it. Anything in the address that chose a language is
// dropped, or it would choose again.
export function switchLanguage(settings, lang) {
  if (!LANGUAGES[lang]) return;
  settings.set('lang', lang);
  const url = new URL(window.location.href);
  if (!url.searchParams.has('lang')) {
    window.location.reload();
    return;
  }
  url.searchParams.delete('lang');
  window.location.replace(url.toString());
}
