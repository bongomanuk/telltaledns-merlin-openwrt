// REQ: API-005 — a list the UI draws from data that can repeat a value is keyed by something unique (Svelte refuses a keyed
// list with two equal keys: the page's update stops with `each_key_duplicate`), and an identity is an id, never the text shown
// for it. Each browser test gives a page a state the server can send (mocked where a one-node test server cannot), checks what
// the page draws, and fails on a page error; a pure function is tested without a page. Expects the state 1-ui.spec.ts leaves
// (the admin, some queries), as 8-i18n-pages.spec.ts does.
import { expect, test, type Page } from '@playwright/test';
import { failOnPageErrors } from './page-errors';

failOnPageErrors(test);
test.use({ viewport: { width: 1280, height: 900 } });

const ADMIN = { user: 'admin', pass: 'correct horse battery' };

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel('Username', { exact: true }).fill(ADMIN.user);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.pass);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' }).first()).toBeVisible({ timeout: 30_000 });
}

const NOW = Math.floor(Date.now() / 1000);

// ---- Change markers (REQ: OBS-033). Past 40 in a chart's window they share a button per 8-px column, drawn at the pixel of
// its first marker, so two neighbouring columns can be drawn at one pixel; the charts key their buttons by the column.

const change = (t: number, seq: number) => ({ tUnixMs: Math.round(t * 1000), kind: 'config.applied', summary: `change ${seq}`, seq, node: null, nodes: [], actor: null, href: null });
/** The left edge (px) of every marker button, chart by chart. */
const lefts = (page: Page) =>
  page.getByTestId('chart-markers').evaluateAll((layers) => layers.map((l) => [...l.querySelectorAll<HTMLElement>('button.mk')].map((b) => parseFloat(b.style.left))));

/**
 * Two markers at `a` and `b` (Unix seconds) show where the page's charts draw a time. The page is then loaded with markers in
 * pairs half a pixel apart, every 16.3 px across: the pairs' place against the 8-px columns moves by 0.3 px from one pair to
 * the next, so some pair has one marker in [8k + 3.5, 8k + 4) and the other in [8k + 4, 8k + 4.5), two columns drawn at one
 * pixel. Every chart (`charts` of them) must draw its buttons, some at one pixel, with no page error.
 */
async function straddle(page: Page, path: string, charts: number, a: number, b: number) {
  // Two loads of a page with charts after the sign-in, each waited for.
  test.setTimeout(60_000);
  const marks = { times: [a, b] };
  await page.route('**/api/v1/annotations?**', (r) => r.fulfill({ json: { items: marks.times.map((t, i) => change(t, i + 1)), truncated: false, missingNodes: [] } }));
  await page.goto(`/#${path}`);
  // A new load: the page may be at that address already, with the server's own markers.
  await page.reload();
  await expect.poll(async () => (await lefts(page)).map((l) => l.length), { timeout: 20_000 }).toEqual(Array(charts).fill(2));
  const [[xa, xb]] = await lefts(page);
  const at = (x: number) => a + ((x - xa) * (b - a)) / (xb - xa);
  const times: number[] = [];
  for (let x = xa + 2; x + 0.5 <= xb - 2; x += 16.3) times.push(at(x), at(x + 0.5));
  expect(times.length, 'more than 40 markers: 8-px columns').toBeGreaterThan(40);
  marks.times = times;
  await page.reload();
  const shared = (l: number[]) => l.length - new Set(l).size;
  await expect
    .poll(async () => (await lefts(page)).map((l) => (l.length > 2 && shared(l) > 0 ? 'drawn, two at one pixel' : `${l.length} buttons, ${shared(l)} at a shared pixel`)), { timeout: 20_000 })
    .toEqual(Array(charts).fill('drawn, two at one pixel'));
}

test('api_005 obs_033 markers that share a pixel in two columns: the cache page and its two charts', async ({ page }) => {
  // The last hour of one node, a sample every 15 s: the charts' window is fixed.
  const end = Math.floor(NOW / 15) * 15;
  const point = (i: number) => ({ answeredPercent: 80, at: new Date((end - (240 - i) * 15) * 1000).toISOString(), bytes: 1e6, entries: 100, evictions: 0, hitPercent: 70, lookups: 50, prefetches: 0, staleServed: 0 });
  const stats = { answeredPercent: 80, bytes: 1e6, entries: 100, evictions: 0, hitPercent: 70, hits: 900, inserts: 500, misses: 100, node: null, prefetches: 0, staleServed: 0, uncacheable: 0, settings: null, sizing: null, warmStart: null, history: Array.from({ length: 241 }, (_, i) => point(i)) };
  await page.route('**/api/v1/cache/stats', (r) => r.fulfill({ json: { items: [stats] } }));
  await signIn(page);
  await straddle(page, '/cache', 2, end - 3300, end - 300);
});

test('api_005 obs_033 markers that share a pixel in two columns: the dashboard', async ({ page }) => {
  await signIn(page);
  await straddle(page, '/', 1, NOW - 22 * 3600, NOW - 2 * 3600);
});

test('api_005 obs_033 markers that share a pixel in two columns: the previous dashboard', async ({ page }) => {
  await signIn(page);
  await straddle(page, '/?view=legacy', 1, NOW - 22.8 * 3600, NOW - 1.2 * 3600);
});
