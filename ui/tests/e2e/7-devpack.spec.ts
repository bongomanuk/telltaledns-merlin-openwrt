// REQ: API-012 (ADR-189), API-013 (ADR-190) — what the build's rules share with code that runs them in the
// browser, without a browser: the whole agreement rule apart from the runtime's first-use check, the shipping
// function, the template's slot in the build; and testing a language pack: the template, the check of a
// translated file, the tag, and what a page keeps in its storage. (The pages are 9-devpack.spec.ts.)
import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { cleanup, project, put, uiCopy, under } from './i18n-fixture';
import * as safe from '../../src/lib/i18n/safe';
import { agree } from '../../src/lib/i18n/agree';
import { hash } from '../../src/lib/i18n/ident';
import { tr } from '../../src/lib/i18n';
import { parse, type Catalog } from '../../src/lib/i18n/pairs';
import { MAX_BYTES, MULTI_SCRIPT, checkPack, decodeFile, markers, shownName, tagInfo, type Tag } from '../../src/lib/i18n/pack';
import { identity, ship } from '../../src/lib/i18n/shipping';
import { forPullRequest, materialize, readTemplate, writeTemplate, type Template } from '../../src/lib/i18n/template';
import { brokenWords, leftoverWords, refusalWords, tagWords, worthWords } from '../../src/lib/devpack/packWords';
import * as lib from '../../scripts/i18n-lib.mjs';

const UI = resolve(import.meta.dirname, '../..');
const I18N = join(UI, 'src/lib/i18n');
const temps: string[] = [];
test.afterAll(() => {
  cleanup();
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Runs postbuild on a scratch dist: `index.html` loading `assets/index-e1.js` (whose text is `entry`), the
 * files of `locales` in `assets/locales/`, and the emitted list `emitted`. Returns its status and output. */
function postbuild(entry: string, locales: Record<string, string | Buffer>, emitted: object[]) {
  const dir = mkdtempSync(join(tmpdir(), 'tt-dvp-post-'));
  temps.push(dir);
  const dist = join(dir, 'dist');
  mkdirSync(join(dist, 'assets/locales'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), '<!doctype html><script type="module" crossorigin src="/assets/index-e1.js"></script>');
  writeFileSync(join(dist, 'assets/index-e1.js'), entry);
  for (const [name, body] of Object.entries(locales)) writeFileSync(join(dist, 'assets/locales', name), body);
  mkdirSync(join(dir, 'locales'));
  writeFileSync(join(dir, 'locales/manifest.json'), '{}\n');
  writeFileSync(join(dir, 'emitted.json'), JSON.stringify(emitted));
  const r = spawnSync(process.execPath, [join(UI, 'scripts/postbuild.mjs'), `${dist}/`, `${join(dir, 'locales')}/`, join(dir, 'emitted.json')], { encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

/** The modules of `src/lib/i18n/` that `from` imports, itself included, followed through their own imports. */
function importedFrom(from: string): Set<string> {
  const seen = new Set<string>();
  const visit = (f: string) => {
    if (seen.has(f)) return;
    seen.add(f);
    for (const m of readFileSync(join(I18N, f), 'utf8').matchAll(/from '\.\/([^']+)'/g)) {
      const name = /\.(svelte|json)$/.test(m[1]) ? m[1] : `${m[1].replace(/\.ts$/, '')}.ts`;
      if (existsSync(join(I18N, name)) && name.endsWith('.ts')) visit(name);
    }
  };
  visit(from);
  return seen;
}

test('api_012 the runtime check stays apart from the whole rule', () => {
  // The whole rule is a module of its own; the module the runtime imports holds the readings and the runtime's check.
  expect(Object.hasOwn(safe, 'agree')).toBe(false);
  expect(typeof safe.agreesAtRuntime).toBe('function');
  expect(agree('Keep {n}', 'Qa').fails.map((f) => `${f.rule} ${f.token}`)).toEqual(['placeholders {n}']);
  // No module the runtime loads imports it, so the first load of a page never carries it.
  const runtime = importedFrom('index.ts');
  expect(runtime.has('safe.ts')).toBe(true);
  expect([...runtime]).not.toContain('agree.ts');
});

test('api_012 the build admits one template on its own line and the entry holds its name', () => {
  const name = 'template-1a2b3c4d.json';
  const listed = [{ file: name, template: true }];
  const holds = `const T = "/assets/locales/${name}";`;
  // One template, listed, named by the entry chunk: its own line, outside the UI and the languages.
  const ok = postbuild(holds, { [name]: JSON.stringify({ v: 1, contexts: {} }) }, listed);
  expect(ok.out).toMatch(/^template [\d.]+ KiB gzipped \(budget 64\.0 KiB\): assets\/locales\/template-1a2b3c4d\.json, outside the UI and the languages$/m);
  expect(ok.out).toContain('all languages 0.0 KiB gzipped');
  expect(ok.out).toContain('each language at most 80.0 KiB gzipped: 0 file(s) in assets/locales/');
  expect(ok.status, ok.out).toBe(0);
  // The entry chunk does not hold its name: the build's name would not follow the English.
  const unnamed = postbuild('const T = "elsewhere";', { [name]: '{}' }, listed);
  expect(unnamed.status).toBe(1);
  expect(unnamed.out).toContain("the entry chunk does not hold the template's file name (template-1a2b3c4d.json)");
  // Over its budget (incompressible bytes), not listed, listed twice, or listed and missing.
  const big = postbuild(holds, { [name]: randomBytes(70 * 1024) }, listed);
  expect(big.status).toBe(1);
  expect(big.out).toContain('over the 64 KiB the template may take');
  const stray = postbuild(holds, { [name]: '{}' }, []);
  expect(stray.status).toBe(1);
  expect(stray.out).toContain('holds the files the i18n prebuild step emitted');
  const two = postbuild(`${holds} "template-99999999.json"`, { [name]: '{}', 'template-99999999.json': '{}' }, [...listed, { file: 'template-99999999.json', template: true }]);
  expect(two.status).toBe(1);
  expect(two.out).toContain('lists more than one template');
  const gone = postbuild(holds, {}, listed);
  expect(gone.status).toBe(1);
  expect(gone.out).toContain('no file for the template template-1a2b3c4d.json');
  // The URL table has room for the template's address, null until the build writes one.
  const dir = project();
  expect(lib.prebuild(dir)).toBe(1);
  expect(readFileSync(join(dir, 'src/lib/i18n/locales.gen.ts'), 'utf8')).toMatch(/^export const TEMPLATE: string \| null = (null|"\/assets\/locales\/template-[0-9a-f]{8}\.json");$/m);
});

test('api_012 the shipping function is shared and its findings name their pair', () => {
  // The check script ships with the module code in the browser imports.
  expect(lib.ship).toBe(ship);
  const plural = ['{n} file', '{n} files'] as [string, string];
  const entries = new Map([
    [identity('c', plural), { ctx: 'c', english: plural }],
    [identity('c', 'Keep {n}'), { ctx: 'c', english: 'Keep {n}' }],
    [identity('c', 'Open', 'verb'), { ctx: 'c', english: 'Open', note: 'verb' }],
  ]);
  const s = ship({ c: [[plural, { one: 'Qa', other: 'Qa' }], ['Keep {n}', 'Qa'], ['Keep  {n}', 'Qb'], ['Open', 'Qa-open', 'verb'], ['Gone', 'Qa']] }, entries);
  // A plural's form is held to the English of its category; the finding names the pair it came from.
  const fails = s.findings.filter((f) => f.level === 'fail');
  expect(fails.map((f) => [f.rule, f.check ?? '', f.english, JSON.stringify(f.pair), f.note ?? ''])).toEqual([
    ['agreement', 'placeholders', '{n} files', JSON.stringify(plural), ''],
    ['agreement', 'placeholders', 'Keep {n}', '"Keep {n}"', ''],
    ['malformed', '', 'Keep  {n}', '"Keep  {n}"', ''],
  ]);
  expect(s.findings.find((f) => f.level === 'report' && f.token === 'Qa-open')).toMatchObject({ rule: 'agreement-added', check: 'added', pair: 'Open', note: 'verb' });
  expect(Object.values(s.table)).toEqual(['Qa-open']);
  expect([...s.translated]).toEqual([identity('c', 'Open', 'verb')]);
  expect(s.leftovers).toEqual([{ ctx: 'c', english: 'Gone', note: undefined }]);
});

// ---------------------------------------------------------------------------------------------
// API-013: the template

const PLURALS = JSON.parse(readFileSync(join(UI, 'src/locales/plurals.json'), 'utf8')) as Record<string, string[]>;
const code = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The template of the tree `dir`, as the build writes it. */
function templateOf(dir: string): { json: string; tpl: Template } {
  const json = lib.templateJson(lib.check(dir, { ratchets: false }));
  return { json, tpl: readTemplate(json) };
}
/** `sync <tag>` on `dir`, and the file it wrote. */
function synced(dir: string, tag: string): string {
  lib.sync(dir, tag);
  return readFileSync(join(dir, `src/locales/${tag}.json`), 'utf8');
}
let uiTpl: { dir: string; json: string; tpl: Template } | null = null;
/** A copy of the UI's sources with its template (once per worker). */
function uiTemplate() {
  if (!uiTpl) {
    const dir = uiCopy();
    uiTpl = { dir, ...templateOf(dir) };
  }
  return uiTpl;
}

test('api_013 the template equals what sync writes for a new language', () => {
  const { dir, json, tpl } = uiTemplate();
  // Every message of this build, once.
  expect(tpl.entries.size).toBe(lib.check(dir, { ratchets: false }).entries.size);
  expect(tpl.entries.size).toBeGreaterThan(2000);
  for (const tag of ['de', 'fr', 'ru', 'zh-Hans']) {
    rmSync(join(dir, `src/locales/${tag}.json`), { force: true });
    expect(materialize(tpl, PLURALS[new Intl.Locale(tag).language]), tag).toBe(synced(dir, tag));
  }
  // The same tree gives the same bytes.
  expect(templateOf(dir).json).toBe(json);
  // The notes, sensitive marks, verbatim words, glossary and plural table go with it (the fixture has each).
  const f = templateOf(project()).tpl;
  expect(f.entries.get(identity('cache', 'Holds'))?.info).toEqual({ sensitive: true, text: 'A cache entry count' });
  expect(f.entries.get(identity('cache', 'Choose email or ntfy'))?.verbatim).toEqual(['email', 'ntfy']);
  expect(f.glossary).toEqual(['NXDOMAIN']);
  expect([...f.plurals]).toEqual([['qaa', ['other']]]);
  expect(f.contexts).toEqual([...f.contexts].sort(code));
});

test('api_013 plural categories come from the committed table not the engine', () => {
  const { dir, tpl } = uiTemplate();
  const real = Intl.PluralRules;
  let written = '';
  let fromSync = '';
  (Intl as { PluralRules: unknown }).PluralRules = function () {
    throw new Error('the engine was asked for plural rules');
  };
  try {
    rmSync(join(dir, 'src/locales/fr.json'), { force: true });
    written = materialize(tpl, tpl.plurals.get('fr') ?? []);
    fromSync = synced(dir, 'fr');
    templateOf(dir);
  } finally {
    (Intl as { PluralRules: unknown }).PluralRules = real;
  }
  expect(written).toBe(fromSync);
  // French has one, many and other in the committed table: a plural's text has those three.
  expect(tpl.plurals.get('fr')).toEqual(['one', 'many', 'other']);
  const plural = Object.values(parse(written) as Catalog).flat().find((p) => Array.isArray(p[0]));
  expect(Object.keys(plural?.[1] as object)).toEqual(['one', 'many', 'other']);
  // The template carries the committed table itself.
  expect(Object.fromEntries(tpl.plurals)).toEqual(PLURALS);
});

test('api_013 the browser and the script write the same canonical bytes', () => {
  const { dir, tpl } = uiTemplate();
  const cats = tpl.plurals.get('de') ?? [];
  const good = materialize(tpl, cats);
  const cat = parse(good) as Catalog;
  const reversed = Object.fromEntries(Object.entries(cat).reverse().map(([k, v]) => [k, [...v].reverse()]));
  const inputs: Record<string, string> = {
    'shuffled, hand-spaced': JSON.stringify(reversed, null, 3),
    'tabs': JSON.stringify(reversed, null, '\t'),
    'CRLF': good.replace(/\n/g, '\r\n'),
    'one line': JSON.stringify(cat),
  };
  for (const [what, text] of Object.entries(inputs)) {
    put(dir, 'src/locales/de.json', text);
    const fromScript = synced(dir, 'de');
    expect(fromScript, what).toBe(good);
    expect(forPullRequest(parse(text) as Catalog, tpl, cats), what).toBe(fromScript);
  }
  // A byte-order mark: the browser's decoder reads past it, the script refuses the file (as the check does).
  put(dir, 'src/locales/de.json', `﻿${good}`);
  expect(() => lib.sync(dir, 'de')).toThrow();
  expect(forPullRequest(parse(new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(`﻿${good}`))) as Catalog, tpl, cats)).toBe(good);
  // The order is by code unit: some context of the UI sorts otherwise under a collator, and the bytes keep code-unit order.
  const differs = Object.values(cat).some((pairs) => {
    const e = pairs.map((p) => JSON.stringify(p[0]));
    return [...e].sort(code).join('\n') !== [...e].sort((a, b) => a.localeCompare(b)).join('\n') && e.join('\n') === [...e].sort(code).join('\n');
  });
  expect(differs, 'a context whose code-unit order is not its collator order').toBe(true);
});

test('api_013 download for a pull request is what sync writes for that file', () => {
  const { dir, tpl } = uiTemplate();
  const cats = tpl.plurals.get('ru') ?? [];
  const all = [...tpl.entries.values()];
  const one = all.find((e) => typeof e.english === 'string' && !e.note);
  const plural = all.find((e) => Array.isArray(e.english));
  if (!one || !plural) throw new Error('the UI has a message and a plural');
  const pack: Catalog = Object.create(null);
  const add = (ctx: string, p: Catalog[string][number]) => (pack[ctx] ??= []).push(p);
  add(one.ctx, [one.english, 'Перевод']);
  add(one.ctx, ['An English this build does not have', 'Старый']);
  // Russian has one, few, many and other: this plural names two of them, and one the language does not have.
  add(plural.ctx, [plural.english, { one: 'один', other: 'много', two: 'два' }]);
  pack['~leftover'] = [['Older English', 'Старое']];
  const text = JSON.stringify(pack, null, 1);
  put(dir, 'src/locales/ru.json', text);
  const fromScript = synced(dir, 'ru');
  expect(forPullRequest(parse(text) as Catalog, tpl, cats)).toBe(fromScript);
  // Translations kept, the missing added empty, left-over pairs moved aside and never pruned.
  const pr = parse(fromScript) as Catalog;
  expect(pr[one.ctx]).toContainEqual([one.english, 'Перевод']);
  expect(pr[plural.ctx]).toContainEqual([plural.english, { one: 'один', few: '', many: '', other: 'много' }]);
  expect(pr['~leftover']).toEqual([['An English this build does not have', 'Старый'], ['Older English', 'Старое']]);
  expect(Object.values(pr).flat().length).toBe(tpl.entries.size + 2);
});

// ---------------------------------------------------------------------------------------------
// API-013: checking a pack

const DE: Tag = { tag: 'de', language: 'de', dir: 'ltr', categories: ['one', 'other'] };
let fx: Template | null = null;
/** The fixture project's template: 9 messages in cache, common and labels (tests/i18n-fixtures/project). */
const fixture = () => (fx ??= templateOf(project()).tpl);
/** A template of these messages alone. */
const tplOf = (entries: { ctx: string; english: string | [string, string]; note?: string }[]) =>
  readTemplate(writeTemplate(entries, { notes: new Map(), verbatim: new Map(), glossary: [], plurals: { de: ['one', 'other'] } }));
/** The check of `pack` (an object, written as JSON) for German, against the fixture's template or `tpl`. */
function checked(pack: object, tpl = fixture()) {
  const r = checkPack(JSON.stringify(pack, null, 2), false, tpl, DE);
  if (r.refused) throw new Error(`refused: ${JSON.stringify(r.refused)}`);
  return r.checked;
}
const refusal = (text: string) => checkPack(text, false, fixture(), DE).refused;

test('api_013 a pack is refused whole for its structure', () => {
  expect(refusal(JSON.stringify({ cache: [['Holds', 'Hält']] }))).toBeUndefined();
  const cases: [string, object][] = [
    // A key twice, at the top level and inside a plural: the second would hide the first.
    ['{"cache": [["Holds", "x"]], "cache": []}', { code: 'duplicate', key: 'cache', line: 1 }],
    ['{"cache": [[["{n} answer", "{n} answers"], {"one": "a", "one": "b"}]]}', { code: 'duplicate', key: 'one', line: 1 }],
    ['{\n  "cache": [\n    ["Holds", "x"],\n  ]\n}', { code: 'json', line: 4, column: 3 }],
    ['{"cache": [["Holds", "x"]]', { code: 'json' }],
    ['{"cache": [[["a", ["b"]], "x"]]}', { code: 'depth' }],
    ['[]', { code: 'shape' }],
    ['{"cache": {}}', { code: 'shape' }],
    [JSON.stringify({ [hash('cache', 'Holds')]: 'Hält' }), { code: 'shape' }],
    ['{"Cache": [["Holds", "x"]]}', { code: 'context', ctx: 'Cache' }],
    ['{"__proto__": [["Holds", "x"]]}', { code: 'context', ctx: '__proto__' }],
    ['{"cache": [["Holds"]]}', { code: 'pair', ctx: 'cache', n: 1, shape: 'pair' }],
    ['{"cache": [["Holds", "x"], ["Holds", 3]]}', { code: 'pair', ctx: 'cache', n: 2, shape: 'text' }],
    ['{"cache": [[["{n} answer", "{n} answers"], "x"]]}', { code: 'pair', ctx: 'cache', n: 1, shape: 'plural-text' }],
    [JSON.stringify({ cache: [['Holds', 'x'.repeat(4001)]] }), { code: 'long', ctx: 'cache', n: 1 }],
    [JSON.stringify({ cache: Array.from({ length: 10_001 }, (_, i) => [`E${i}`, '']) }), { code: 'pairs' }],
    [JSON.stringify(Object.fromEntries(Array.from({ length: 601 }, (_, i) => [`c${i}`, []]))), { code: 'contexts' }],
    ['x'.repeat(MAX_BYTES + 1), { code: 'size' }],
  ];
  for (const [text, want] of cases) {
    const r = refusal(text);
    expect(r, text.slice(0, 60)).toMatchObject(want);
    // In plain words, and nothing was kept: the check stores nothing itself.
    expect(refusalWords(r!)).toMatch(/^This file can't be used: /);
  }
  expect(refusalWords({ code: 'duplicate', key: 'cache', line: 1, column: 29 })).toBe('This file can\'t be used: the key "cache" appears twice (line 1, column 29); the second would hide the first.');
  expect(refusalWords({ code: 'json', line: 41, column: 7 })).toBe("This file can't be used: it isn't valid JSON (line 41, column 7).");
  // Strict UTF-8; a byte-order mark is read past (and noted: the file is not in the repository's form).
  expect(decodeFile(new Uint8Array([0x7b, 0xff, 0x7d]))).toBeNull();
  expect(decodeFile(new TextEncoder().encode('﻿{}'))).toEqual({ text: '{}', bom: true });
  const bom = checkPack(JSON.stringify({ cache: [['Holds', 'Hält']] }), true, fixture(), DE);
  expect(bom.checked?.canonical).toBe(false);
});

test('api_013 a pack entry that breaks the agreement rule is dropped and named in plain words', () => {
  const c = checked({
    cache: [
      ['Holds', 'Hält'],
      ['Notify by {kind}', 'Benachrichtigen'],
      ['Read https://example.com/docs first.', 'Lies https://evil.example/docs zuerst.'],
      ['Sends mail to smtp://mail.example:587', 'Sendet Mail an smtp://mail.example'],
      ['Choose email or ntfy', 'Wähle E-Mail oder ntfy'],
      ['Kept by <b>{who}</b>', 'Von {who} behalten‮'],
    ],
    common: [['Save', 'Sаve']],
  });
  // Only what agrees is in the table; the rest shows English.
  expect(Object.values(c.table)).toEqual(['Hält']);
  expect(c.translated).toBe(1);
  const words = c.broken.map(brokenWords);
  for (const w of [
    'Keep {kind} exactly as it is: it is replaced by a value.',
    'Keep the web address exactly as in English: https://example.com/docs',
    "This web address isn't in the English: https://evil.example/docs",
    'Keep smtp://mail.example:587 as written.',
    'Keep the number 587.',
    'Keep email untranslated: it is a value people type.',
    'Keep the tag <b> exactly as in the English.',
    'Remove the invisible or direction-changing character U+202E.',
    'A word mixes Latin letters with Cyrillic or Greek ones that look alike: Sаve',
  ])
    expect(words).toContain(w);
  // Each names its entry and the translation it judged.
  expect(c.broken.find((b) => b.rule === 'code-point')).toMatchObject({ ctx: 'cache', english: 'Kept by <b>{who}</b>', translation: 'Von {who} behalten‮', token: 'U+202E' });
  // An entry is not also "missing" when it was dropped.
  expect(c.missing.map((m) => m.english)).toEqual([['{n} answer', '{n} answers'], 'Lists']);
  // Plural categories other than the language's: that entry is dropped, the rest stands.
  const p = checked({ cache: [[['{n} answer', '{n} answers'], { other: '{n} Antworten' }], ['Holds', 'Hält']] });
  expect(p.broken.map(brokenWords)).toEqual(['This language uses one, other; this entry has other.']);
  expect(Object.values(p.table)).toEqual(['Hält']);
});

test('api_013 report-only findings never drop an entry', () => {
  const tpl = tplOf([{ ctx: 'c', english: 'Use the sign-in page' }, { ctx: 'c', english: 'Open the DNS log' }]);
  const c = checked({ c: [['Use the sign-in page', 'Nutze die Anmeldeseite'], ['Open the DNS log', 'Öffne das Protokoll']] }, tpl);
  expect(c.translated).toBe(2);
  expect(c.broken).toEqual([]);
  const words = c.worth.map(worthWords);
  expect(words).toContain('Worth a look: sign-in is not in the translation. Fine if it is an ordinary word.');
  expect(words).toContain('Worth a look: DNS is not in the translation. Keep it if it is a name or an abbreviation.');
  expect(words).toContain('Worth a look: the translation adds Nutze.');
});

test('api_013 a pack pair is current by text never by hash', () => {
  const tpl = tplOf([{ ctx: 'c', english: "Don't stop" }, { ctx: 'c', english: 'Open', note: 'verb' }]);
  // The same text once normalized (a typographic apostrophe, more spaces) is the same message, under its hash.
  const a = checked({ c: [['Don’t   stop', 'Nicht anhalten'], ['Open', 'Öffnen', 'verb']] }, tpl);
  expect(Object.keys(a.table).sort()).toEqual([hash('c', "Don't stop"), hash('c', 'Open', 'verb')].sort());
  // Another note is another message, whatever else it shares.
  const b = checked({ c: [['Open', 'Öffnen', 'adjective']] }, tpl);
  expect(b.translated).toBe(0);
  expect(b.leftovers.map((l) => l.reason)).toEqual(['note']);
  // A file of hashes (what the build ships) is not a pack, and a context named like a hash is no message's.
  expect(checkPack(JSON.stringify({ [hash('c', 'Open', 'verb')]: 'Öffnen' }), false, tpl, DE).refused).toEqual({ code: 'shape' });
  const named = checkPack(JSON.stringify({ [hash('c', 'Open', 'verb')]: [['Open', 'Öffnen', 'verb']] }), false, tpl, DE);
  expect(named.refused?.code === 'context' || named.checked?.translated === 0).toBe(true);
});

test('api_013 a left-over pair says why', () => {
  const c = checked({ cache: [['Holds', 'Hält', 'my own note'], ['Holds now', 'Hält jetzt']], '~leftover': [['Older', 'Älter']] });
  expect(c.leftovers.map((l) => [l.ctx, l.english, l.reason, leftoverWords(l)])).toEqual([
    ['cache', 'Holds', 'note', 'Same English, different note: keep the third item as in the template.'],
    ['cache', 'Holds now', 'gone', "This English isn't in this build: it changed, or it was edited in the file."],
    ['~leftover', 'Older', 'aside', 'Set aside under "~leftover": it is kept there and not used.'],
  ]);
  expect(c.missing).toContainEqual({ ctx: 'cache', english: 'Holds', note: undefined });
  expect(c.translated).toBe(0);
});

test('api_013 pack entries named like object members are data', () => {
  const words = ['constructor', 'toString', 'hasOwnProperty', 'valueOf'];
  const tpl = tplOf([...words.map((w) => ({ ctx: w, english: w })), { ctx: 'c', english: '__proto__' }, { ctx: 'c', english: ['{n} toString', '{n} valueOf'] }]);
  const pack = `{${words.map((w, i) => `"${w}": [["${w}", "${words[(i + 1) % words.length]}"]]`).join(', ')}, "c": [["__proto__", "__proto__ x"], [["{n} toString", "{n} valueOf"], {"__proto__": "{n} a", "constructor": "{n} b"}]]}`;
  const r = checkPack(pack, false, tpl, DE);
  expect(r.refused).toBeUndefined();
  const c = r.checked!;
  expect(c.translated).toBe(5);
  expect(c.table[hash('constructor', 'constructor')]).toBe('toString');
  expect(c.table[hash('c', '__proto__')]).toBe('__proto__ x');
  expect(Object.getPrototypeOf(c.table)).toBeNull();
  // A plural whose categories are named like members is a plural with other categories: dropped, nothing else touched.
  expect(c.broken.map((b) => [b.rule, b.got])).toEqual([['categories', ['__proto__', 'constructor']]]);
  expect(({} as Record<string, unknown>).a).toBeUndefined();
  expect(Object.prototype.toString.call({})).toBe('[object Object]');
  // The runtime reads such a table as data.
  under({ tag: 'de', table: c.table as never }, () => {
    expect(tr('constructor').t('constructor')).toBe('toString');
    expect(tr('valueOf').t('valueOf')).toBe('constructor');
  });
});

test('api_013 coverage counts a plural group once and lists missing and left-over entries', () => {
  const c = checked({ cache: [[['{n} answer', '{n} answers'], { one: '{n} Antwort', other: '{n} Antworten' }], ['Holds', 'Hält'], ['Gone', 'Weg']], common: [['Save', '']] });
  expect([c.total, c.translated]).toEqual([9, 2]);
  expect(c.coverage).toEqual([
    { ctx: 'common', total: 1, translated: 0 },
    { ctx: 'labels', total: 1, translated: 0 },
    { ctx: 'cache', total: 7, translated: 2 },
  ]);
  expect(c.missing).toHaveLength(7);
  expect(c.missing).toContainEqual({ ctx: 'common', english: 'Save', note: undefined });
  expect(c.leftovers).toEqual([{ ctx: 'cache', english: 'Gone', note: undefined, reason: 'gone' }]);
});

test('api_013 the language tag is canonical and known', () => {
  const plurals = new Map(Object.entries(PLURALS));
  const ok = (s: string) => {
    const r = tagInfo(s, plurals);
    return r.ok ? r.value : null;
  };
  const why = (s: string) => {
    const r = tagInfo(s, plurals);
    return r.ok ? null : r.why;
  };
  expect(ok('pt-br')).toEqual({ tag: 'pt-BR', language: 'pt', dir: 'ltr', categories: ['one', 'many', 'other'] });
  expect(ok(' zh-hant ')?.tag).toBe('zh-Hant');
  expect(ok('DE')).toEqual({ tag: 'de', language: 'de', dir: 'ltr', categories: ['one', 'other'] });
  expect([ok('ar')?.dir, ok('he')?.dir, ok('sr-Latn')?.dir]).toEqual(['rtl', 'rtl', 'ltr']);
  for (const s of ['zh', 'sr', 'en', 'en-GB', 'en-XA', 'ar-XB', 'qaa', 'qtz', 'mis', 'mul', 'zxx', 'und', 'x-foo', 'tok', 'iw', '__proto__', 'garbage!!', '', 'de-DE-1996', 'de-u-co-phonebk'])
    expect(ok(s), s).toBeNull();
  expect(why('zh')).toEqual({ code: 'script', language: 'zh', hint: 'zh-Hans' });
  expect(tagWords(why('zh')!)).toBe('This language is written in more than one script: add the script, such as zh-Hans.');
  expect([why('tok')?.code, why('en-GB')?.code, why('en-XA')?.code, why('ar-XB')?.code, why('qaa')?.code, why('und')?.code, why('')?.code]).toEqual(['plurals', 'english', 'english', 'pseudo', 'reserved', 'reserved', 'empty']);
  // The committed table decides, not the engine's alias data: `iw` is refused whether or not the engine reads it as `he`.
  expect(['alias', 'plurals']).toContain(why('iw')?.code);
  expect(tagWords(why('tok')!)).toBe("TelltaleDNS doesn't know the plural forms of this language yet: ask for it to be added.");
  // A tag accepted here is one the repository's check accepts in its manifest; the same languages of several scripts.
  for (const s of ['de', 'fr', 'pt-BR', 'zh-Hans', 'zh-Hant', 'sr-Latn', 'ar', 'ja']) expect(lib.canonicalTagError(ok(s)?.tag ?? s), s).toBeNull();
  expect(MULTI_SCRIPT).toEqual(lib.MULTI_SCRIPT);
});

test('api_013 the agreement rule stays linear on hostile input', () => {
  const hostile = ['a'.repeat(4000), `https://${':'.repeat(3990)}`, '{'.repeat(4000), '<a'.repeat(2000), `${'a.'.repeat(1999)}a`, `${'1.'.repeat(1999)}1`, '‮'.repeat(4000), `${'ab-'.repeat(1333)}a`, `[${'x'.repeat(3998)}`, 'ｈｔｔｐｓ：／／'.repeat(400), `${'{n} '.repeat(1000)}`];
  const time = (s: string) => {
    const t0 = performance.now();
    agree(s, [...s].reverse().join(''));
    agree('Keep {n} at https://a.example:53/x', s);
    return performance.now() - t0;
  };
  for (const s of hostile) {
    const quarter = time(s.slice(0, s.length / 4));
    const full = time(s);
    expect(full, JSON.stringify(s.slice(0, 24))).toBeLessThan(500);
    expect(full, JSON.stringify(s.slice(0, 24))).toBeLessThan(Math.max(50, quarter * 16));
  }
  // A whole file of them is checked within the same kind of bound.
  const t0 = performance.now();
  checkPack(JSON.stringify({ cache: hostile.map((s, i) => [i ? `Gone ${i}` : 'Holds', s]) }), false, fixture(), DE);
  expect(performance.now() - t0).toBeLessThan(3000);
});

test('api_013 a displayed file name loses forbidden code points and is cut to 48', () => {
  expect(shownName('nos‮j.ed')).toBe('nosj.ed');
  expect(shownName('de​.json')).toBe('de.json');
  expect(shownName('a\nb\tc.json')).toBe('abc.json');
  expect(shownName('de.json')).toBe('de.json');
  const cut = shownName(`${'x'.repeat(100)}.json`);
  expect([...cut]).toHaveLength(48);
  expect(cut).toBe(`${'x'.repeat(23)}…${'x'.repeat(19)}.json`);
  // By code point: never half of a pair.
  expect([...shownName('\u{1F600}'.repeat(60))]).toHaveLength(48);
  expect(shownName('\u{1F600}'.repeat(60)).includes('�')).toBe(false);
  // Pack text on the check screen: a visible marker for each forbidden code point.
  expect(markers('ab‮cd')).toBe('ab⟨U+202E⟩cd');
  expect(markers('a\u{E0041}b')).toBe('a⟨U+E0041⟩b');
  expect(markers('plain')).toBe('plain');
});
