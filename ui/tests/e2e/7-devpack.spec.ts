// REQ: API-012 (ADR-189) — what the build's rules share with code that runs them in the browser, without a
// browser: the whole agreement rule apart from the runtime's first-use check.
import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as safe from '../../src/lib/i18n/safe';
import { agree } from '../../src/lib/i18n/agree';
import { identity, ship } from '../../src/lib/i18n/shipping';
import * as lib from '../../scripts/i18n-lib.mjs';

const UI = resolve(import.meta.dirname, '../..');
const I18N = join(UI, 'src/lib/i18n');

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
