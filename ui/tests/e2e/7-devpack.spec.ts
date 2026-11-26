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
import { cleanup, project, put, uiCopy } from './i18n-fixture';
import * as safe from '../../src/lib/i18n/safe';
import { agree } from '../../src/lib/i18n/agree';
import { parse, type Catalog } from '../../src/lib/i18n/pairs';
import { identity, ship } from '../../src/lib/i18n/shipping';
import { forPullRequest, materialize, readTemplate, type Template } from '../../src/lib/i18n/template';
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
