// Checks the translations against the game.
//
//   node tools/i18n/check.mjs          every language in src/lang
//   node tools/i18n/check.mjs --keys   just list what there is to translate
//
// Finds every string the game says (t('...'), msg('...'), notebook entries,
// and the `data-t` text in index.html), then reports, for each language, the
// ones it has no translation for, translations whose {placeholders} do not
// match the English, and translations nothing uses any more. It also finds
// any t() that a local variable called `t` has taken the place of (a time,
// usually: update(dt, t)), which only fails when that line runs. Exits
// non-zero if anything is wrong, so it can run in CI.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseAst } from 'rolldown/parseAst';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SRC = join(ROOT, 'src');

// A JavaScript string literal, without interpolation.
const LIT = String.raw`'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|\`(?:[^\`\\$]|\\.)*\``;
const value = (lit) => new Function(`return ${lit}`)();

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (p !== join(SRC, 'lang')) walk(p, out);
    } else if (p.endsWith('.js')) {
      out.push(p);
    }
  }
  return out;
}

// key -> where it is used
const keys = new Map();
const add = (key, where) => {
  if (!key) return;
  if (!keys.has(key)) keys.set(key, where);
};

for (const file of walk(SRC)) {
  const src = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file);
  const line = (i) => `${rel}:${src.slice(0, i).split('\n').length}`;
  // t('...'), msg('...'), hasNote('...')
  for (const m of src.matchAll(new RegExp(String.raw`\b(?:t|msg|hasNote)\(\s*(${LIT})`, 'g'))) {
    add(value(m[1]), line(m.index));
  }
  // A string concatenated across lines inside t( ... ), as for long HTML.
  for (const m of src.matchAll(new RegExp(String.raw`\bt\(\s*((?:${LIT})(?:\s*\+\s*(?:${LIT}))+)`, 'g'))) {
    add(value(m[1]), line(m.index));
  }
  // note('Category', 'Text') and note('Category', cond ? 'A' : 'B'): every
  // literal in the call.
  for (const m of src.matchAll(/\bnote\(/g)) {
    let depth = 0;
    let end = m.index + m[0].length - 1;
    for (; end < src.length; end++) {
      if (src[end] === '(') depth++;
      else if (src[end] === ')' && --depth === 0) break;
    }
    const args = src.slice(m.index + m[0].length, end);
    if (/^\s*category\b/.test(args)) continue; // the definition itself
    // Built from a template: matched by pattern instead (PT_PATTERNS).
    if (/`[^`]*\$\{/.test(args)) {
      const cat = new RegExp(`^\\s*(${LIT})`).exec(args);
      if (cat) add(value(cat[1]), line(m.index));
      continue;
    }
    for (const l of args.matchAll(new RegExp(LIT, 'g'))) add(value(l[0]), line(m.index));
  }
}

// index.html: data-t="key", <x data-t>text</x>, <x data-t-html>markup</x>
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', mdash: '—', middot: '·', nbsp: ' ', larr: '←', rarr: '→', uarr: '↑', darr: '↓' };
const decode = (s) => s.replace(/&(#\d+|\w+);/g, (m, e) => (e[0] === '#' ? String.fromCharCode(Number(e.slice(1))) : ENTITIES[e] ?? m));
const norm = (s) => s.replace(/\s+/g, ' ').trim();
for (const m of html.matchAll(/<(\w+)([^>]*?)\sdata-t(-html)?(?:="([^"]*)")?([^>]*)>([\s\S]*?)<\/\1>/g)) {
  const [, , , isHtml, explicit, , inner] = m;
  const where = `index.html:${html.slice(0, m.index).split('\n').length}`;
  if (explicit) add(decode(explicit), where);
  // The browser hands back non-breaking spaces as &nbsp; in innerHTML.
  else if (isHtml) add(norm(inner), where);
  else add(norm(decode(inner.replace(/<[^>]+>/g, ''))), where);
}
for (const m of html.matchAll(/data-t-aria[^>]*aria-label="([^"]*)"|aria-label="([^"]*)"[^>]*data-t-aria/g)) {
  add(decode(m[1] ?? m[2]), 'index.html');
}

// t() and friends hidden by a local binding of the same name. Conservative:
// a name declared anywhere in a function counts for all of it.
const I18N_NAMES = new Set(['t', 'msg', 'tNote', 'tLoose', 'theItem']);
const shadowed = [];
for (const file of walk(SRC)) {
  const src = readFileSync(file, 'utf8');
  if (!/from '(\.\.?\/)+i18n\.js'/.test(src)) continue;
  const names = (p, out = []) => {
    if (!p) return out;
    if (p.type === 'Identifier') out.push(p.name);
    else if (p.type === 'ObjectPattern') p.properties.forEach((q) => names(q.type === 'RestElement' ? q.argument : q.value, out));
    else if (p.type === 'ArrayPattern') p.elements.forEach((e) => names(e, out));
    else if (p.type === 'AssignmentPattern') names(p.left, out);
    else if (p.type === 'RestElement') names(p.argument, out);
    return out;
  };
  const children = (n) => Object.entries(n).flatMap(([k, v]) => (k === 'parent' ? [] : Array.isArray(v) ? v : [v]))
    .filter((c) => c && typeof c.type === 'string');
  const declared = (body) => {
    const out = [];
    const visit = (n) => {
      if (/Function/.test(n.type)) {
        if (n.type === 'FunctionDeclaration' && n.id) out.push(n.id.name);
        return;
      }
      if (n.type === 'VariableDeclaration') n.declarations.forEach((d) => names(d.id, out));
      if (n.type === 'ClassDeclaration' && n.id) out.push(n.id.name);
      if (n.type === 'CatchClause') names(n.param, out);
      children(n).forEach(visit);
    };
    children(body).forEach(visit);
    return out;
  };
  const scan = (n, local) => {
    if (/Function/.test(n.type)) {
      local = new Set([...local, ...n.params.flatMap((p) => names(p)), ...declared(n.body)]);
    }
    if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && I18N_NAMES.has(n.callee.name) && local.has(n.callee.name)) {
      shadowed.push(`${relative(ROOT, file)}:${src.slice(0, n.start).split('\n').length}  ${n.callee.name}() is a local variable here`);
    }
    children(n).forEach((c) => scan(c, local));
  };
  scan(parseAst(src), new Set());
}
for (const s of shadowed) console.log(`  shadowed    ${s}`);
let failed = shadowed.length > 0;

if (process.argv.includes('--keys')) {
  for (const [k, where] of keys) console.log(`${where}\t${JSON.stringify(k)}`);
  console.log(`\n${keys.size} strings`);
  process.exit(0);
}

const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const langs = readdirSync(join(SRC, 'lang')).filter((d) => statSync(join(SRC, 'lang', d)).isDirectory());
for (const lang of langs) {
  const mod = await import(pathToFileURL(join(SRC, 'lang', lang, 'index.js')).href);
  const dict = mod.default;
  // The same English in two of the language's files, said two ways.
  const seenIn = new Map();
  for (const file of readdirSync(join(SRC, 'lang', lang)).filter((f) => f !== 'index.js')) {
    const part = (await import(pathToFileURL(join(SRC, 'lang', lang, file)).href)).default;
    for (const [k, v] of Object.entries(part)) {
      const before = seenIn.get(k);
      if (before && before.v !== v) {
        console.log(`  conflict    ${JSON.stringify(k)}: ${before.file} ${JSON.stringify(before.v)} / ${file} ${JSON.stringify(v)}`);
        failed = true;
      }
      seenIn.set(k, { v, file });
    }
  }
  const missing = [...keys].filter(([k]) => !Object.prototype.hasOwnProperty.call(dict, k));
  const mismatched = Object.entries(dict).filter(([k, v]) => placeholders(k) !== placeholders(v));
  // Keys the game builds at run time (a board status, a town, a noise) are
  // only ever passed to t() as a variable, so are listed as data instead.
  const runtime = new Set(mod.RUNTIME_KEYS ?? []);
  const unused = Object.keys(dict).filter((k) => !keys.has(k) && !runtime.has(k));
  console.log(`[${lang}] ${keys.size - missing.length}/${keys.size} translated, ${Object.keys(dict).length} entries`);
  for (const [k, where] of missing) console.log(`  missing     ${where}  ${JSON.stringify(k)}`);
  for (const [k] of mismatched) console.log(`  {mismatch}  ${JSON.stringify(k)}`);
  for (const k of unused) console.log(`  unused      ${JSON.stringify(k)}`);
  if (missing.length || mismatched.length) failed = true;
}
process.exit(failed ? 1 : 0);
