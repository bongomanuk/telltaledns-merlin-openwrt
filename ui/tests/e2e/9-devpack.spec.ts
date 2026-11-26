// REQ: API-013 (ADR-190) — testing a language pack, in the browser against the real server: the card under
// Settings → Account (Advanced view), the template and the check, Use and the reload, the English banner above
// every overlay, the pause on the sign-in, setup and two-factor screens, the removal on another build of the web UI
// or the server, after 7 days and when damaged, and what a pack never reaches. The tests sign in once for real as
// the suite's admin (as 2-shots.spec.ts does; the admin is created from the setup token when this file runs
// alone, as 1-ui.spec.ts does), keep the cookies only, and give each test a fresh context: no pack reaches another
// test. They write nothing to the server. (The parts that need no browser are 7-devpack.spec.ts.)
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as lib from '../../scripts/i18n-lib.mjs';
import { DATA, jsonStrings, makeCollides, makeRule, readPage } from './i18n-pseudo-rule';

const UI = resolve(import.meta.dirname, '../..');
const ADMIN = { user: 'admin', pass: 'correct horse battery' };
const KEY = 'telltale.devpack';
const DAY = 86_400_000;

type Entry = { ctx: string; english: string | [string, string]; note?: string };
const ENTRIES = [...(lib.check(UI, { ratchets: false }).entries as Map<string, Entry>).values()];
/** A message of the UI, which must exist (a fixture never names English the UI does not have). */
function message(ctx: string, english: Entry['english']): Entry {
  const e = ENTRIES.find((x) => x.ctx === ctx && JSON.stringify(x.english) === JSON.stringify(english) && !x.note);
  if (!e) throw new Error(`no message ${ctx}: ${JSON.stringify(english)}`);
  return e;
}
const SETTINGS = message('settings', 'Settings');
const SIGN_IN = message('login', 'Sign in');
const FLUSHED = message('cacheCard', ['Removed {n} entry{errors}.', 'Removed {n} entries{errors}.']);
/** A small French pack: the Settings heading, the sign-in heading and a plural of French's three categories. */
const FR: Record<string, unknown[]> = {
  [SETTINGS.ctx]: [[SETTINGS.english, 'Réglages']],
  [SIGN_IN.ctx]: [[SIGN_IN.english, 'Se connecter']],
  [FLUSHED.ctx]: [[FLUSHED.english, { one: '{n} entrée supprimée{errors}.', many: '{n} d’entrées supprimées{errors}.', other: '{n} entrées supprimées{errors}.' }]],
};
const FR_TEXT = JSON.stringify(FR, null, 2);
const valueOf = (ctx: string) => (FR[ctx][0] as [unknown, string])[1];
/** Every message of the UI, translated as its English with a marker after it (a pack that changes every label). */
const MARK = 'ZQXJ';
const ALL_TEXT = JSON.stringify(
  Object.fromEntries(
    [...new Set(ENTRIES.map((e) => e.ctx))].map((ctx) => [
      ctx,
      ENTRIES.filter((e) => e.ctx === ctx).map((e) => {
        const tx = typeof e.english === 'string' ? `${e.english} ${MARK}` : { one: `${e.english[0]} ${MARK}`, many: `${e.english[1]} ${MARK}`, other: `${e.english[1]} ${MARK}` };
        return e.note ? [e.english, tx, e.note] : [e.english, tx];
      }),
    ]),
  ),
);

let signedIn: { cookies: Awaited<ReturnType<BrowserContext['storageState']>>['cookies']; origins: [] };
let COMMIT = '';
let ENTRY = '';
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const page = await context.newPage();
  await page.goto('/');
  const welcome = page.getByRole('heading', { name: 'Welcome to TelltaleDNS' });
  await expect(welcome.or(page.getByRole('heading', { name: 'Sign in' }))).toBeVisible();
  if (await welcome.isVisible()) {
    // This file alone: the first run's admin, as 1-ui.spec.ts creates it.
    const token = readFileSync(join(UI, '.e2e/data/setup-token'), 'utf8').trim();
    await page.getByLabel('Setup token').fill(token);
    await page.getByLabel('Admin username').fill(ADMIN.user);
    await page.getByLabel('Password (at least 10 characters)').fill(ADMIN.pass);
    await page.getByLabel('Repeat password').fill(ADMIN.pass);
    await page.getByRole('button', { name: 'Create admin and sign in' }).click();
  } else {
    await page.getByLabel('Username', { exact: true }).fill(ADMIN.user);
    await page.getByLabel('Password', { exact: true }).fill(ADMIN.pass);
    await page.getByRole('button', { name: 'Sign in' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Dashboard' }).first()).toBeVisible({ timeout: 30_000 });
  COMMIT = (await (await page.request.get('/api/v1/system/info')).json()).build.commit;
  ENTRY = await page.evaluate(() => new URL((document.querySelector('script[type="module"]') as HTMLScriptElement).src).pathname);
  signedIn = { cookies: (await context.storageState()).cookies, origins: [] };
  await context.close();
});

/** A fresh context (signed in unless `signedOut`), its page, and the problems the page reports (page errors and
 * console errors but a 401 or 403, as 1-ui.spec.ts; `allow` names others the test expects). */
async function fresh(browser: Browser, o: { signedOut?: boolean; width?: number; allow?: RegExp; init?: () => void } = {}) {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    storageState: o.signedOut ? undefined : signedIn,
    viewport: o.width ? { width: o.width, height: 700 } : undefined,
  });
  if (o.init) await context.addInitScript(o.init);
  // No change markers on the charts: those that earlier spec files leave are not this file's subject (server text
  // under translate="no": no pack text), and in a dense last hour a chart can repeat a marker column's key, a page
  // error unrelated to packs. Requests are still seen: the request event fires for a routed request.
  await context.route(
    (u) => u.pathname === '/api/v1/annotations',
    (q) => (q.request().method() === 'GET' ? q.fulfill({ json: { items: [], truncated: false } }) : q.fallback()),
  );
  const page = await context.newPage();
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`page error: ${e.message} (${page.url()}; ${(e.stack ?? '').split('\n').slice(1, 3).join(' | ').slice(0, 200)})`));
  page.on('console', (m) => {
    if (m.type() !== 'error' || /status of 40[13]/.test(m.text()) || o.allow?.test(m.text())) return;
    problems.push(`console: ${m.text()}`);
  });
  return { context, page, problems };
}
const done = async (s: { context: BrowserContext; problems: string[] }) => {
  expect(s.problems, 'no page errors or CSP violations').toEqual([]);
  await s.context.close();
};

/** Keeps a pack in this browser as the card's Use does (the record and the text in one key). From an address
 * of its own, so the page the test opens next is a new page load (a change of the hash alone is not). */
async function storePack(page: Page, text: string, o: { tag?: string; name?: string; ui?: string; commit?: string; loadedAt?: number; fails?: number } = {}) {
  await page.goto('/?devpack-test=store');
  const loadedAt = o.loadedAt ?? Date.now();
  const rec = {
    v: 1, ui: o.ui ?? ENTRY, server: { commit: o.commit ?? COMMIT }, loadedAt, expires: loadedAt + 7 * DAY, name: o.name ?? 'fr.json',
    sha: createHash('sha256').update(text).digest('hex'), tag: o.tag ?? 'fr', dir: 'ltr', fails: o.fails ?? 0, text,
  };
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify(rec)]);
  return rec;
}
const kept = (page: Page) => page.evaluate((k) => localStorage.getItem(k), KEY);
const banner = (page: Page) => page.getByTestId('devpack-banner');
/** Settings → Account in the Advanced view, with the card open. */
async function openCard(page: Page) {
  await page.goto('/#/settings?tab=account');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const card = page.getByTestId('devpack-card');
  if (!(await card.isVisible())) {
    const advanced = page.getByRole('button', { name: 'Advanced', exact: true });
    if (await advanced.isVisible()) await advanced.click();
    else {
      await page.getByRole('button', { name: /^Menu/ }).click();
      await page.getByRole('button', { name: 'Advanced view' }).click();
    }
  }
  await expect(card).toBeVisible();
  if (await page.getByTestId('devpack-open').isVisible()) await page.getByTestId('devpack-open').click();
  await expect(page.getByTestId('devpack-body')).toBeVisible();
  await expect(page.getByTestId('devpack-tag-line')).not.toContainText('Loading');
  return card;
}
/** Chooses a file in the card (the tag as typed, or from the file's name). */
async function chooseFile(page: Page, text: string | Buffer, name = 'fr.json', tag?: string) {
  if (tag !== undefined) await page.getByTestId('devpack-tag').fill(tag);
  await page.getByTestId('devpack-file').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.isBuffer(text) ? text : Buffer.from(text) });
}
/** Where the banner's Remove button is, the element on top there is the button. */
const removeOnTop = (page: Page) =>
  page.evaluate(() => {
    const b = document.querySelector('[data-testid="devpack-remove"]');
    if (!b) return 'no Remove button';
    const r = b.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return top === b || b.contains(top) ? 'on top' : `covered by ${top?.outerHTML.slice(0, 80)}`;
  });
const templateUrl = () => /TEMPLATE: string \| null = "([^"]+)"/.exec(readFileSync(join(UI, 'src/lib/i18n/locales.gen.ts'), 'utf8'))?.[1] ?? '';

test('api_013 an english session loads no pack code and makes no pack request', async ({ browser }) => {
  const s = await fresh(browser);
  const assets: string[] = [];
  s.page.on('request', (r) => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith('/assets/')) assets.push(path);
  });
  await s.page.goto('/');
  for (const [path, heading] of [['/#/', 'Dashboard'], ['/#/queries', 'Query log'], ['/#/settings?tab=account', 'Settings']]) {
    await s.page.goto(path);
    await expect(s.page.getByRole('heading', { name: heading }).first()).toBeVisible();
  }
  // In the Advanced view the card is there, as a heading, a sentence and Open: its code is not loaded.
  await s.page.getByRole('button', { name: 'Advanced', exact: true }).click();
  await expect(s.page.getByTestId('devpack-open')).toBeVisible();
  await expect(banner(s.page)).toHaveCount(0);
  // For the size measurement: what an English reader downloads.
  console.log(`DVP_EAGER ${JSON.stringify([...new Set(assets)].sort())}`);
  expect(assets.filter((p) => p.endsWith('.js') && !/^\/assets\/(index|brands)-[\w-]+\.js$/.test(p))).toEqual([]);
  expect(assets.filter((p) => p.startsWith('/assets/locales/'))).toEqual([]);
  expect(await kept(s.page)).toBeNull();
  await done(s);
});

test('api_013 the template downloads for a chosen tag', async ({ browser }) => {
  const s = await fresh(browser);
  // The template, as the built binary serves it.
  const res = await s.page.request.get(templateUrl(), { headers: { 'accept-encoding': 'gzip' } });
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('application/json');
  expect(res.headers()['cache-control']).toContain('immutable');
  expect(res.headers()['content-encoding']).toBe('gzip');
  // Imported here, so the file loads (and each test fails on its own) on a tree without the module.
  const { readTemplate, materialize } = await import('../../src/lib/i18n/template');
  const tpl = readTemplate(await res.text());
  await openCard(s.page);
  await s.page.getByTestId('devpack-tag').fill('de');
  await expect(s.page.getByTestId('devpack-tag-line')).toContainText('saved as de');
  const [download] = await Promise.all([s.page.waitForEvent('download'), s.page.getByTestId('devpack-template').click()]);
  expect(download.suggestedFilename()).toBe('de.json');
  // Chromium's bytes are Node's for this build (both read the committed plural table the template carries).
  const bytes = readFileSync(await download.path());
  expect(bytes.toString('utf8')).toBe(materialize(tpl, tpl.plurals.get('de') ?? []));
  expect(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
  const [notes] = await Promise.all([s.page.waitForEvent('download'), s.page.getByTestId('devpack-notes').click()]);
  expect(notes.suggestedFilename()).toBe('de-notes.txt');
  const text = readFileSync(await notes.path(), 'utf8');
  expect(text).toContain('TelltaleDNS: notes for translators of de.json');
  expect(text).toContain('Plural forms of this language: one, other.');
  expect(text).toContain(`Made from web UI build ${ENTRY.replace(/^\/assets\//, '').replace(/\.js$/, '')}`);
  // A tag the committed table does not know is refused, with no download.
  await s.page.getByTestId('devpack-tag').fill('tok');
  await expect(s.page.getByTestId('devpack-tag-line')).toContainText("doesn't know the plural forms of this language");
  await expect(s.page.getByTestId('devpack-template')).toHaveCount(0);
  await done(s);
});

test('api_013 a loaded pack shows after apply and reload', async ({ browser }) => {
  const s = await fresh(browser);
  let removed = [0, 1, 2];
  await s.page.route('**/api/v1/cache/flush', (r) => r.fulfill({ json: { totalRemoved: removed.shift() ?? 2, nodes: [] } }));
  await openCard(s.page);
  await chooseFile(s.page, FR_TEXT);
  // The tag comes from the file's name.
  await expect(s.page.getByTestId('devpack-tag')).toHaveValue('fr');
  await expect(s.page.getByTestId('devpack-summary')).toContainText(`fr.json: 3 of ${ENTRIES.length.toLocaleString('en-US')} texts translated`);
  await s.page.getByTestId('devpack-use').click();
  await expect(s.page.getByTestId('devpack-confirm')).toContainText('Use this language pack in this browser?');
  // Use reloads into Settings, where the card opens with the pack in use and fetches the template itself (after
  // the load event, at times): wait for that, so the count below covers the next page load alone.
  const cardTemplate = s.page.waitForResponse((r) => new URL(r.url()).pathname.startsWith('/assets/locales/template-'));
  await Promise.all([s.page.waitForEvent('load'), s.page.getByTestId('devpack-confirm-use').click()]);
  await cardTemplate;
  // The record keeps the check's table for this build and this file: a load after Use fetches neither the
  // template nor the checking code.
  expect(JSON.parse((await kept(s.page)) ?? '{}').checked).toMatchObject({ ui: ENTRY, sha: createHash('sha256').update(FR_TEXT).digest('hex') });
  const after: string[] = [];
  s.page.on('request', (r) => after.push(new URL(r.url()).pathname));
  await s.page.goto('/?devpack-test=again#/');
  await expect(s.page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(banner(s.page)).toBeVisible();
  expect(after.filter((p) => p.startsWith('/assets/locales/') || /\/recheck-[\w-]+\.js$/.test(p))).toEqual([]);
  // After the reload: the pack's text, its lang and dir, and its plural rules.
  await s.page.goto('/#/settings?tab=account');
  await expect(s.page.getByRole('heading', { level: 1 })).toHaveText(valueOf(SETTINGS.ctx));
  await expect(s.page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(s.page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(banner(s.page)).toContainText('Test language pack: fr.json (français, fingerprint ');
  await expect(banner(s.page)).toContainText(createHash('sha256').update(FR_TEXT).digest('hex').slice(0, 12));
  await s.page.goto('/#/cache');
  const card = s.page.getByTestId('cache-card');
  await card.locator('form input').fill('i18n.example');
  const said: string[] = [];
  for (let i = 0; i < 3; i++) {
    await card.locator('div.row button').first().click();
    await expect(s.page.getByTestId('cache-flushed')).toContainText(`${i} `);
    said.push((await s.page.getByTestId('cache-flushed').innerText()).trim());
  }
  // French counts 0 as one; English would say "0 entries".
  expect(said).toEqual(['0 entrée supprimée.', '1 entrée supprimée.', '2 entrées supprimées.']);
  await done(s);
});

test('api_013 the banner stays on top of every overlay', async ({ browser }) => {
  const s = await fresh(browser, { width: 360 });
  await storePack(s.page, FR_TEXT, { name: `${'x'.repeat(200)}.json` });
  // A drawer (a help panel).
  await s.page.goto('/#/settings?tab=account');
  await expect(banner(s.page)).toBeVisible();
  await s.page.locator('button[data-help="account"]').click();
  await expect(s.page.locator('.drawer')).toBeVisible();
  expect(await removeOnTop(s.page)).toBe('on top');
  const below = await s.page.evaluate(() => [document.querySelector('[data-testid="devpack-banner"]')?.getBoundingClientRect().bottom ?? 0, document.querySelector('.drawer')?.getBoundingClientRect().top ?? 0]);
  expect(below[1]).toBeGreaterThanOrEqual(below[0] - 1);
  await s.page.keyboard.press('Escape');
  // The phone menu: the banner on top, and the menu's last item (the build) reachable below it.
  await s.page.goto('/#/');
  await s.page.getByRole('button', { name: /^Menu/ }).click();
  await expect(s.page.locator('nav.side')).toBeVisible();
  expect(await removeOnTop(s.page)).toBe('on top');
  const footer = s.page.getByTestId('build-footer');
  await footer.scrollIntoViewIfNeeded();
  await expect(footer).toBeInViewport();
  expect(await s.page.evaluate(() => {
    const f = document.querySelector('[data-testid="build-footer"]');
    const r = f?.getBoundingClientRect();
    const top = r && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!f && !!top && f.contains(top);
  })).toBe(true);
  // The wall.
  await s.page.goto('/#/wall');
  await expect(s.page.getByTestId('wall-area')).toBeVisible();
  expect(await removeOnTop(s.page)).toBe('on top');
  // A long file name does not push Remove off a phone screen.
  expect(await s.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(banner(s.page)).toContainText(`${'x'.repeat(23)}…`);
  await done(s);
});

test('api_013 the pack is paused on the sign-in setup and two-factor screens', async ({ browser }) => {
  const s = await fresh(browser, { signedOut: true });
  await storePack(s.page, FR_TEXT, { commit: 'unknown-when-signed-out' });
  // Sign-in: English, and the banner says it is paused.
  await s.page.goto('/');
  await expect(s.page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(s.page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(banner(s.page)).toContainText('The test language pack fr.json is paused on this page.');
  await expect(s.page.getByTestId('devpack-once')).toBeVisible();
  // Two-factor: the code step of the same page.
  await s.page.route('**/api/v1/auth/login', (r) => r.fulfill({ status: 401, json: { type: 'about:blank', title: 'Unauthorized', status: 401, code: 'totp_required', detail: 'a code is needed' } }));
  await s.page.getByLabel('Username', { exact: true }).fill('someone');
  await s.page.getByLabel('Password', { exact: true }).fill('a long password');
  await s.page.getByRole('button', { name: 'Sign in' }).click();
  await expect(s.page.getByText('Enter the 6-digit code from your authenticator app.')).toBeVisible();
  await expect(banner(s.page)).toContainText('is paused on this page');
  // Setup.
  await s.page.route('**/api/v1/auth/status', (r) => r.fulfill({ json: { setupRequired: true, user: null, oidc: [], localLogin: true, csrfToken: null } }));
  await s.page.reload();
  await expect(s.page.getByRole('heading', { name: 'Welcome to TelltaleDNS' })).toBeVisible();
  await expect(s.page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(banner(s.page)).toContainText('is paused on this page');
  expect(JSON.parse((await kept(s.page)) ?? '{}').name).toBe('fr.json');
  await done(s);
});

test('api_013 show the test pack on this page lasts one load', async ({ browser }) => {
  const s = await fresh(browser, { signedOut: true });
  await storePack(s.page, FR_TEXT);
  await s.page.goto('/');
  await expect(s.page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await Promise.all([s.page.waitForEvent('load'), s.page.getByTestId('devpack-once').click()]);
  await expect(s.page.getByRole('heading', { name: valueOf(SIGN_IN.ctx) })).toBeVisible();
  await expect(s.page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(banner(s.page)).toContainText('Test language pack: fr.json');
  expect(await s.page.evaluate(() => sessionStorage.getItem('telltale.devpack.once'))).toBeNull();
  // The next load is paused again.
  await s.page.reload();
  await expect(s.page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(banner(s.page)).toContainText('is paused on this page');
  await done(s);
});

test('api_013 signing in with a paused pack reloads into the pack', async ({ browser }) => {
  const s = await fresh(browser, { signedOut: true });
  await storePack(s.page, FR_TEXT);
  await s.page.goto('/');
  await expect(banner(s.page)).toContainText('is paused on this page');
  await s.page.getByLabel('Username', { exact: true }).fill(ADMIN.user);
  await s.page.getByLabel('Password', { exact: true }).fill(ADMIN.pass);
  await s.page.getByRole('button', { name: 'Sign in' }).click();
  // The first build answer after sign-in reloads the page into the pack.
  await expect(s.page.locator('html')).toHaveAttribute('lang', 'fr', { timeout: 30_000 });
  await expect(banner(s.page)).toContainText('Test language pack: fr.json');
  await s.page.goto('/#/settings?tab=account');
  await expect(s.page.getByRole('heading', { level: 1 })).toHaveText(valueOf(SETTINGS.ctx));
  await done(s);
});

test('api_013 the banner removes the pack from any page', async ({ browser }) => {
  for (const path of ['/#/', '/#/queries', '/#/settings?tab=account', '/#/wall', '/#/display?token=not-a-token']) {
    const s = await fresh(browser);
    await storePack(s.page, FR_TEXT);
    await s.page.goto(path);
    await expect(banner(s.page), path).toBeVisible();
    await Promise.all([s.page.waitForEvent('load'), s.page.getByTestId('devpack-remove').click()]);
    await expect(s.page.locator('html'), path).toHaveAttribute('lang', 'en');
    await expect(banner(s.page), path).toHaveCount(0);
    expect(await kept(s.page), path).toBeNull();
    await done(s);
  }
});

test('api_013 a pack is cleared when the web ui build changes', async ({ browser }) => {
  const s = await fresh(browser);
  await storePack(s.page, FR_TEXT, { ui: '/assets/index-OLDBUILD.js' });
  await s.page.goto('/#/settings?tab=account');
  await expect(banner(s.page)).toContainText('The test language pack fr.json was removed: TelltaleDNS was updated.');
  await expect(s.page.getByRole('heading', { level: 1 })).toHaveText('Settings');
  expect(JSON.parse((await kept(s.page)) ?? '{}')).toMatchObject({ v: 1, gone: 'upgrade', name: 'fr.json' });
  // The card shows it too, in the Simple view; Dismiss removes the notice.
  await expect(s.page.getByTestId('devpack-card-notice')).toBeVisible();
  await s.page.getByRole('button', { name: 'Dismiss this notice' }).first().click();
  await expect(banner(s.page)).toHaveCount(0);
  expect(await kept(s.page)).toBeNull();
  await done(s);
});

test('api_013 a pack is cleared when the server build changes', async ({ browser }) => {
  // The first answer of a load: removed, a reload, the notice.
  const a = await fresh(browser);
  await storePack(a.page, FR_TEXT, { commit: 'an-older-build' });
  await a.page.goto('/#/settings?tab=account');
  await expect(banner(a.page)).toContainText('was removed: TelltaleDNS was updated.');
  await expect(a.page.locator('html')).toHaveAttribute('lang', 'en');
  expect(JSON.parse((await kept(a.page)) ?? '{}').gone).toBe('upgrade');
  await done(a);
  // A later answer (the server upgraded while the tab is open): removed, said, and no reload.
  const b = await fresh(browser);
  await b.page.clock.install();
  await storePack(b.page, FR_TEXT);
  await b.page.goto('/#/settings?tab=account');
  await expect(b.page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(banner(b.page)).toContainText('Test language pack: fr.json');
  await b.page.route('**/api/v1/system/info', async (r) => {
    const res = await r.fetch();
    const info = await res.json();
    info.build.commit = 'a-newer-build';
    await r.fulfill({ response: res, json: info });
  });
  await b.page.evaluate(() => ((window as unknown as { __dvpNoReload: boolean }).__dvpNoReload = true));
  await b.page.clock.runFor(61_000);
  await expect(banner(b.page)).toContainText('TelltaleDNS was updated: the test pack goes away when you reload.');
  expect(await b.page.evaluate(() => (window as unknown as { __dvpNoReload?: boolean }).__dvpNoReload)).toBe(true);
  expect(JSON.parse((await kept(b.page)) ?? '{}').gone).toBe('upgrade');
  await done(b);
});

test('api_013 a pack expires after seven days', async ({ browser }) => {
  const s = await fresh(browser);
  await storePack(s.page, FR_TEXT);
  await s.page.clock.install({ time: new Date(Date.now() + 7 * DAY + 60_000) });
  await s.page.goto('/#/settings?tab=account');
  await expect(banner(s.page)).toContainText('The test language pack fr.json was removed: it was loaded 7 days ago.');
  await expect(s.page.locator('html')).toHaveAttribute('lang', 'en');
  expect(JSON.parse((await kept(s.page)) ?? '{}').gone).toBe('expired');
  await done(s);
});

test('api_013 a damaged stored pack falls back without a blank page', async ({ browser }) => {
  // A value that is not a record.
  const a = await fresh(browser);
  await a.page.goto('/?devpack-test=store');
  await a.page.evaluate((k) => localStorage.setItem(k, '{"v":1,"ui":'), KEY);
  await a.page.goto('/#/');
  await expect(a.page.getByRole('heading', { name: 'Dashboard' }).first()).toBeVisible();
  await expect(banner(a.page)).toContainText("was removed: the copy kept in this browser couldn't be read.");
  await done(a);
  // The template answered 500, damaged, or not at all: the usual language, and the pack stays.
  for (const [what, handle] of [
    ['500', (r: import('@playwright/test').Route) => r.fulfill({ status: 500, body: '' })],
    ['damaged', (r: import('@playwright/test').Route) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"v": 1, "contexts"' })],
    ['hung', () => undefined],
  ] as const) {
    const s = await fresh(browser, { allow: /status of 500|ERR_|Failed to load/ });
    await storePack(s.page, FR_TEXT);
    await s.page.route('**/assets/locales/template-*.json', handle);
    await s.page.goto('/#/');
    await expect(s.page.getByRole('heading', { name: 'Dashboard' }).first(), what).toBeVisible({ timeout: 20_000 });
    await expect(banner(s.page), what).toContainText('could not be checked, so this page is in your usual language');
    await expect(s.page.locator('html'), what).toHaveAttribute('lang', 'en');
    expect(JSON.parse((await kept(s.page)) ?? '{}').fails, what).toBe(0);
    await done(s);
  }
});

test("api_013 a card opened in a tab from before an upgrade says reload", async ({ browser }) => {
  const s = await fresh(browser, { allow: /status of 404/ });
  await s.page.route('**/assets/DevPackCard-*.js', (r) => r.fulfill({ status: 404, body: '' }));
  await s.page.goto('/#/settings?tab=account');
  await s.page.getByRole('button', { name: 'Advanced', exact: true }).click();
  await s.page.getByTestId('devpack-open').click();
  await expect(s.page.getByTestId('devpack-stale')).toHaveText('TelltaleDNS was updated: reload this page.');
  await expect(s.page.getByTestId('devpack-card').getByRole('button', { name: 'Reload' })).toBeVisible();
  await done(s);
});

test('api_013 blocked storage still checks and downloads but refuses use', async ({ browser }) => {
  const s = await fresh(browser, {
    init: () => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('blocked', 'SecurityError');
        },
      });
    },
  });
  await openCard(s.page);
  await s.page.getByTestId('devpack-tag').fill('fr');
  const [download] = await Promise.all([s.page.waitForEvent('download'), s.page.getByTestId('devpack-template').click()]);
  expect(download.suggestedFilename()).toBe('fr.json');
  await chooseFile(s.page, FR_TEXT);
  await expect(s.page.getByTestId('devpack-summary')).toContainText('fr.json: 3 of');
  await s.page.getByTestId('devpack-use').click();
  await s.page.getByTestId('devpack-confirm-use').click();
  await expect(s.page.getByTestId('devpack-use-error')).toHaveText("This browser can't keep the pack: its storage is full or blocked.");
  await done(s);
});

test('api_013 a quota error on use writes nothing', async ({ browser }) => {
  const s = await fresh(browser, {
    init: () => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (this: Storage, k: string, v: string) {
        if (k === 'telltale.devpack' && (window as unknown as { __dvpFull?: boolean }).__dvpFull) throw new DOMException('full', 'QuotaExceededError');
        return set.call(this, k, v);
      };
    },
  });
  await storePack(s.page, FR_TEXT, { name: 'earlier.json' });
  await openCard(s.page);
  // The page load checked the kept file and kept its table with it.
  const before = await kept(s.page);
  expect(JSON.parse(before ?? '{}')).toMatchObject({ name: 'earlier.json', checked: { ui: ENTRY } });
  await s.page.evaluate(() => ((window as unknown as { __dvpFull: boolean }).__dvpFull = true));
  await chooseFile(s.page, JSON.stringify({ [SETTINGS.ctx]: [[SETTINGS.english, 'Paramètres']] }), 'fr.json');
  await s.page.getByTestId('devpack-use').click();
  await s.page.getByTestId('devpack-confirm-use').click();
  await expect(s.page.getByTestId('devpack-use-error')).toBeVisible();
  // The pack kept before is the one still kept, as it was.
  expect(await kept(s.page)).toBe(before);
  // How much this browser keeps for one address (for the report: a record holds the file's text and its table).
  const fits = await s.page.evaluate(() => {
    let most = 0;
    for (const n of [1_000_000, 2_000_000, 2_500_000, 3_000_000, 4_000_000, 5_000_000]) {
      try {
        localStorage.setItem('telltale.devpack.probe', 'x'.repeat(n));
        most = n;
      } catch {
        break;
      }
    }
    localStorage.removeItem('telltale.devpack.probe');
    return most;
  });
  console.log(`DVP_QUOTA this Chromium keeps a value of ${fits} characters (and not the next size tried)`);
  await done(s);
});

test('api_013 a pack whose table does not fit is kept without it', async ({ browser }) => {
  // A store that refuses the record with its table, and takes it without.
  const s = await fresh(browser, {
    init: () => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (this: Storage, k: string, v: string) {
        if (k === 'telltale.devpack' && v.includes('"checked"')) throw new DOMException('full', 'QuotaExceededError');
        return set.call(this, k, v);
      };
    },
  });
  await openCard(s.page);
  await chooseFile(s.page, FR_TEXT);
  await s.page.getByTestId('devpack-use').click();
  await Promise.all([s.page.waitForEvent('load'), s.page.getByTestId('devpack-confirm-use').click()]);
  // Kept without the table; each load checks the file again, and the page is in the pack's language.
  const rec = JSON.parse((await kept(s.page)) ?? '{}');
  expect([rec.name, rec.checked]).toEqual(['fr.json', undefined]);
  await s.page.goto('/?devpack-test=again#/settings?tab=account');
  await expect(s.page.getByRole('heading', { level: 1 })).toHaveText(valueOf(SETTINGS.ctx));
  await expect(banner(s.page)).toContainText('Test language pack: fr.json');
  await done(s);
});

test('api_013 lang parameter pauses the pack for one page load', async ({ browser }) => {
  const s = await fresh(browser);
  await storePack(s.page, FR_TEXT);
  await s.page.goto('/?lang=en#/settings?tab=account');
  await expect(s.page.getByRole('heading', { level: 1 })).toHaveText('Settings');
  await expect(s.page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(banner(s.page)).toContainText('is paused for this page load: the address asks for a language.');
  await s.page.goto('/?lang=en-XA#/settings?tab=account');
  await expect(s.page.locator('html')).toHaveAttribute('lang', 'en-XA');
  await s.page.goto('/#/settings?tab=account');
  await expect(s.page.getByRole('heading', { level: 1 })).toHaveText(valueOf(SETTINGS.ctx));
  await expect(s.page.locator('html')).toHaveAttribute('lang', 'fr');
  await done(s);
});

/** What a page sends and keeps: every request (method, address, body), and every value written to storage. */
async function record(s: { context: BrowserContext; page: Page }) {
  const sent: string[] = [];
  s.page.on('request', (r) => sent.push(`${r.method()} ${r.url()} ${r.postData() ?? ''}`));
  await s.context.addInitScript(() => {
    const w = window as unknown as { __dvpStored: string[] };
    w.__dvpStored = [];
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (this: Storage, k: string, v: string) {
      w.__dvpStored.push(`${k}=${v}`);
      return set.call(this, k, v);
    };
  });
  return { sent, stored: () => s.page.evaluate(() => (window as unknown as { __dvpStored?: string[] }).__dvpStored ?? []) };
}

test('api_013 pack text never reaches a request or storage', async ({ browser }) => {
  const s = await fresh(browser);
  const r = await record(s);
  await storePack(s.page, ALL_TEXT);
  for (const [path, testid] of [['/#/', 'dashboard-chart'], ['/#/queries', ''], ['/#/clients', ''], ['/#/settings?tab=account', 'devpack-card'], ['/#/settings?tab=tokens', ''], ['/#/cache', 'cache-card']]) {
    await s.page.goto(path);
    await expect(s.page.locator('html')).toHaveAttribute('lang', 'fr');
    if (testid) await expect(s.page.getByTestId(testid).first()).toBeVisible();
    await expect(s.page.locator('main').first()).toContainText(MARK);
  }
  // A search and a filter, typed and chosen through the translated page.
  await s.page.locator('form[role="search"] input').fill('nas.e2e.test');
  await s.page.locator('form[role="search"] input').press('Enter');
  await expect(s.page).toHaveURL(/name=nas\.e2e\.test/);
  await expect(s.page.locator('html')).toHaveAttribute('lang', 'fr');
  const decoded = (x: string) => {
    try {
      return decodeURIComponent(x);
    } catch {
      return x;
    }
  };
  expect(r.sent.filter((x) => x.includes(MARK) || decoded(x).includes(MARK))).toEqual([]);
  expect((await r.stored()).filter((x) => !x.startsWith(`${KEY}=`) && x.includes(MARK))).toEqual([]);
  expect(await s.page.evaluate((m) => Object.keys(localStorage).filter((k) => k !== 'telltale.devpack' && (localStorage.getItem(k) ?? '').includes(m)), MARK)).toEqual([]);
  await done(s);
});

test('api_013 a pack never translates its own warning banner and buttons', async ({ browser }) => {
  const s = await fresh(browser);
  await storePack(s.page, ALL_TEXT, { name: 'all.json' });
  await s.page.goto('/#/settings?tab=account');
  await expect(s.page.locator('html')).toHaveAttribute('lang', 'fr');
  // Every message of the page is the pack's; the banner and the card's own buttons are not.
  await expect(s.page.getByRole('heading', { level: 1 })).toHaveText(`Settings ${MARK}`);
  await expect(banner(s.page)).toContainText('Test language pack: all.json');
  expect(await banner(s.page).innerText()).not.toContain(MARK);
  await expect(s.page.getByTestId('devpack-in-use')).toBeVisible();
  for (const name of ['Remove and reload', 'Download for a pull request (fr.json)']) await expect(s.page.getByTestId('devpack-in-use').getByRole('button', { name, exact: true })).toBeVisible();
  expect(await s.page.getByTestId('devpack-in-use').locator('p').first().innerText()).toMatch(/^In use: all\.json, French \(français\) \(fr\), fingerprint [0-9a-f]{12}\./);
  await chooseFile(s.page, ALL_TEXT, 'all.json', 'fr');
  await expect(s.page.getByTestId('devpack-use')).toHaveText('Use this pack…');
  await expect(s.page.getByTestId('devpack-pr')).toHaveText('Download for a pull request (fr.json)');
  await s.page.getByTestId('devpack-use').click();
  expect(await s.page.getByTestId('devpack-confirm').innerText()).not.toContain(MARK);
  await expect(s.page.getByTestId('devpack-confirm-use')).toHaveText('Use it and reload');
  await done(s);
});

test("api_013 the card's actions send nothing about the pack", async ({ browser }) => {
  const s = await fresh(browser);
  const r = await record(s);
  await s.page.goto('/#/settings?tab=account');
  await expect(s.page.getByRole('heading', { level: 1 })).toBeVisible();
  const from = r.sent.length;
  await openCard(s.page);
  await s.page.getByTestId('devpack-tag').fill('fr');
  await Promise.all([s.page.waitForEvent('download'), s.page.getByTestId('devpack-template').click()]);
  await Promise.all([s.page.waitForEvent('download'), s.page.getByTestId('devpack-notes').click()]);
  await chooseFile(s.page, FR_TEXT);
  await Promise.all([s.page.waitForEvent('download'), s.page.getByTestId('devpack-pr').click()]);
  const beforeUse = r.sent.length;
  await s.page.getByTestId('devpack-use').click();
  await Promise.all([s.page.waitForEvent('load'), s.page.getByTestId('devpack-confirm-use').click()]);
  const card = r.sent.slice(from, beforeUse);
  // Only reads: the card's chunk and its stylesheet, the template, and the app's own polls.
  expect(card.filter((x) => !x.startsWith('GET '))).toEqual([]);
  expect(card.filter((x) => x.includes('/assets/locales/')).map((x) => new URL(x.split(' ')[1]).pathname)).toEqual([templateUrl()]);
  // Use: one /system/info for the server's build; then the reload.
  const use = r.sent.slice(beforeUse);
  expect(use.filter((x) => !x.startsWith('GET '))).toEqual([]);
  expect(use.filter((x) => x.includes('/api/v1/system/info')).length).toBeGreaterThanOrEqual(1);
  // Nothing about the file in any request: its name, fingerprint or text.
  const sha = createHash('sha256').update(FR_TEXT).digest('hex');
  for (const needle of ['fr.json', sha, sha.slice(0, 12), 'Réglages', 'R%C3%A9glages', 'Se connecter', 'supprim']) expect(r.sent.filter((x) => x.includes(needle)), needle).toEqual([]);
  await done(s);
});

test('api_013 the check screen shows pack text inert', async ({ browser }) => {
  const s = await fresh(browser);
  await openCard(s.page);
  const pack = { [SETTINGS.ctx]: [[SETTINGS.english, 'Régla‮ges abc']], [SIGN_IN.ctx]: [[SIGN_IN.english, '<b>Se</b> connecter']] };
  await chooseFile(s.page, JSON.stringify(pack), 'fr.json');
  await s.page.getByTestId('devpack-broken').locator('summary').click();
  const list = s.page.getByTestId('devpack-broken').locator('li');
  await expect(list.first()).toBeVisible();
  // The direction override is a visible marker, and the rest of the line keeps its order.
  await expect(list.filter({ hasText: 'U+202E' }).first()).toContainText('Régla⟨U+202E⟩ges abc');
  // A tag is shown as typed, never as markup.
  await expect(list.filter({ hasText: 'connecter' }).first()).toContainText('<b>Se</b> connecter');
  expect(await s.page.getByTestId('devpack-broken').locator('li b').count()).toBe(0);
  await done(s);
});

test('api_013 a refused file says why and stores nothing', async ({ browser }) => {
  const s = await fresh(browser);
  await openCard(s.page);
  const cases: [string | Buffer, string][] = [
    [`{"${SETTINGS.ctx}": [], "${SETTINGS.ctx}": []}`, `This file can't be used: the key "${SETTINGS.ctx}" appears twice (line 1, column`],
    [Buffer.from([0x7b, 0xff, 0x7d]), "This file can't be used: it isn't UTF-8 text."],
    [Buffer.alloc(1024 * 1024 + 1, 0x20), "This file can't be used: it is larger than 1 MiB."],
    ['{"settings": [["Settings"]]}', `This file can't be used: pair 1 of "settings" is not in the form of the template.`],
  ];
  for (const [text, says] of cases) {
    await chooseFile(s.page, text, 'fr.json', 'fr');
    await expect(s.page.getByTestId('devpack-refused')).toContainText(says);
    await expect(s.page.getByTestId('devpack-use')).toHaveCount(0);
  }
  expect(await kept(s.page)).toBeNull();
  await done(s);
});

test('api_013 the pack card works with the keyboard and at 360 px', async ({ browser }) => {
  const s = await fresh(browser, { width: 360 });
  await s.page.goto('/#/settings?tab=account');
  await s.page.getByRole('button', { name: /^Menu/ }).click();
  await s.page.getByRole('button', { name: 'Advanced view' }).click();
  await s.page.keyboard.press('Escape');
  await s.page.getByTestId('devpack-open').focus();
  await s.page.keyboard.press('Enter');
  await expect(s.page.getByTestId('devpack-tag')).toBeVisible();
  // A real label names each field.
  await expect(s.page.getByLabel('Language tag (such as de, fr, pt-BR or zh-Hant)')).toBeVisible();
  await s.page.getByTestId('devpack-tag').focus();
  await s.page.keyboard.type('fr');
  await s.page.keyboard.press('Tab');
  await expect(s.page.getByTestId('devpack-template')).toBeFocused();
  await chooseFile(s.page, FR_TEXT);
  await expect(s.page.getByTestId('devpack-summary')).toHaveAttribute('role', 'status');
  await s.page.getByTestId('devpack-use').focus();
  await s.page.keyboard.press('Enter');
  // The confirmation's heading takes the focus; Escape gives it back.
  await expect(s.page.locator('#devpack-confirm')).toBeFocused();
  await s.page.keyboard.press('Escape');
  await expect(s.page.getByTestId('devpack-use')).toBeFocused();
  for (const d of ['devpack-broken', 'devpack-missing', 'devpack-left', 'devpack-worth', 'devpack-coverage']) await s.page.getByTestId(d).locator('summary').click();
  expect(await s.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await done(s);
});

// The whole-page rule of the pseudo-locale (8-i18n-pseudo.spec.ts), on the card, its states and the banner.
const MESSAGES = ENTRIES.flatMap((e) => (Array.isArray(e.english) ? e.english : [e.english]));
// The help glossary is English outside the layer (ADR-189: help stays English in part A), as 8-i18n-pseudo.spec.ts has it.
const HELP: string[] = JSON.parse(readFileSync(join(UI, '../docs/help/topics.json'), 'utf8')).topics.flatMap((t: Record<string, unknown>) =>
  Object.values(t).filter((v): v is string => typeof v === 'string'),
);
const RULE = makeRule({ data: DATA, help: HELP, messages: MESSAGES });
const collides = makeCollides(MESSAGES);
async function leftovers(page: Page, received: Set<string>) {
  const { text, other, help, at } = await page.evaluate(readPage);
  const places = new Map<string, string[]>();
  for (const [x, place] of at) places.set(x, [...(places.get(x) ?? []), place]);
  return RULE.found(text, other, [...received].filter((v) => !collides(v)), help, places).map((x) => `${x} (${places.get(JSON.parse(x))?.slice(0, 2).join('; ')})`);
}

test('api_012 pseudo locale leaves no literal text: the language pack card and banner', async ({ browser }) => {
  const s = await fresh(browser);
  const received = new Set<string>();
  s.page.on('response', (r) => {
    if (/json/.test(r.headers()['content-type'] ?? '') && !r.url().includes('/assets/locales/')) void r.text().then((t) => jsonStrings(JSON.parse(t), received), () => undefined);
  });
  await storePack(s.page, FR_TEXT);
  await s.page.goto('/?lang=en-XA#/settings?tab=account');
  await expect(s.page.locator('html')).toHaveAttribute('lang', 'en-XA');
  // A pack is kept here: the card shows in the Simple view, open.
  await expect(s.page.getByTestId('devpack-in-use')).toBeVisible();
  expect(await leftovers(s.page, received), 'the banner (paused) and the card with a pack in use').toEqual([]);
  // A file checked, every list open; then the confirmation.
  const pack = { ...FR, [SETTINGS.ctx]: [[SETTINGS.english, 'Régla‮ges'], ['Gone', 'Parti']], '~leftover': [['Older', 'Ancien']] };
  await chooseFile(s.page, JSON.stringify(pack), 'fr.json', 'fr');
  await expect(s.page.getByTestId('devpack-summary').last()).toContainText('fr.json');
  for (const d of ['devpack-broken', 'devpack-missing', 'devpack-left', 'devpack-worth', 'devpack-coverage']) await s.page.getByTestId(d).locator('summary').click();
  expect(await leftovers(s.page, received), 'a checked file, its lists open').toEqual([]);
  await s.page.getByTestId('devpack-use').click();
  expect(await leftovers(s.page, received), 'the confirmation').toEqual([]);
  // A refused file, a refused tag, and the notice after a removal.
  await chooseFile(s.page, '{"a": 1, "a": 2}', 'fr.json', 'fr');
  expect(await leftovers(s.page, received), 'a refused file').toEqual([]);
  await s.page.getByTestId('devpack-tag').fill('zh');
  expect(await leftovers(s.page, received), 'a refused tag').toEqual([]);
  await s.page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ v: 1, gone: 'failed', name: 'fr.json', at: Date.now() })), KEY);
  await s.page.reload();
  await expect(s.page.getByTestId('devpack-card-notice')).toBeVisible();
  expect(await leftovers(s.page, received), 'the notice in the banner and the card').toEqual([]);
  await done(s);
});
