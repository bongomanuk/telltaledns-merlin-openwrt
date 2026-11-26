// REQ: API-013 (ADR-190) — what a page load does with the test language pack this browser keeps,
// before the page is drawn (design: "At start-up"):
//   a. a notice (the pack was removed) is shown until dismissed, 7 days at most;
//   b. another web UI build, 7 days gone, or a value that is not a record removes the pack, with a notice;
//   c. `?lang=` pauses it for this load; so does a page where nobody is signed in (sign-in, two-factor,
//      setup, a server that cannot be reached), a display link and a display session, unless "Show the
//      test pack on this page" asked for this one load;
//   d. the template is fetched (a failure: the usual language, and the pack stays for the next load);
//   e. the file is checked again with the build's rules: a check that throws twice in a row retires it;
//   f. its table is installed as the page's language.
// Pure: storage, network, time and the check come in `Deps`, so the tests hold every path.
import type { Choice } from '../i18n';
import { formatLocale } from '../i18n/match';
import { checkPack, tagInfo } from '../i18n/pack';
import { readTemplate } from '../i18n/template';
import { LIFETIME_MS, forget, lifetime, notice, readValue, write, type Gone, type PackRecord, type Store } from './store';

export type Paused = 'signed-out' | 'display' | 'param';
type Named = { readonly name: string; readonly sha: string; readonly tag: string };
/** What the banner shows. */
export type View =
  | { readonly kind: 'none' }
  | { readonly kind: 'notice'; readonly gone: Gone; readonly name: string }
  | ({ readonly kind: 'active' | 'unchecked' | 'updated' | 'signed-in' } & Named)
  | ({ readonly kind: 'paused'; readonly why: Paused } & Named);

export type Deps = {
  readonly store: Store | null;
  /** Reads and removes the one-load flag of "Show the test pack on this page". */
  readonly takeOnce: () => boolean;
  readonly fetch: typeof fetch;
  readonly now: () => number;
  /** This web UI build, and the address of its template. */
  readonly ui: string;
  readonly template: string | null;
  readonly search: string;
  readonly hash: string;
  readonly languages: readonly string[];
  readonly check: typeof checkPack;
  /** For the two requests together (the catalog's limit). */
  readonly timeoutMs: number;
};

/** The page's language from the pack (null: the usual language), what the banner shows, and the
 * record that still applies (null when there is none, or it was just removed). */
export type Decision = { readonly choice: Choice | null; readonly view: View; readonly record: PackRecord | null; readonly paused?: Paused };

const NONE: Decision = { choice: null, view: { kind: 'none' }, record: null };

export async function decide(value: string, d: Deps): Promise<Decision> {
  const now = d.now();
  const got = readValue(value);
  const removed = (gone: Gone, name: string): Decision => {
    write(d.store, notice(gone, name, now));
    return { choice: null, view: { kind: 'notice', gone, name }, record: null };
  };
  // a, b: a notice, a value that is not a record, another build, 7 days.
  if ('damaged' in got) return removed('damaged', '');
  if ('notice' in got) {
    if (now - got.notice.at > LIFETIME_MS) {
      forget(d.store);
      return NONE;
    }
    return { choice: null, view: { kind: 'notice', gone: got.notice.gone, name: got.notice.name }, record: null };
  }
  const r = got.record;
  const gone = lifetime(r, d.ui, now);
  if (gone) return removed(gone, r.name);
  const named: Named = { name: r.name, sha: r.sha, tag: r.tag };
  const paused = (why: Paused): Decision => ({ choice: null, view: { kind: 'paused', why, ...named }, record: r, paused: why });
  const unchecked: Decision = { choice: null, view: { kind: 'unchecked', ...named }, record: r };
  // c: `?lang=` is this load's language.
  if (new URLSearchParams(d.search).has('lang')) return paused('param');
  const once = d.takeOnce();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), d.timeoutMs);
  let json: string;
  try {
    // c: who is signed in (the public status the app reads anyway).
    let status: { user?: { display?: unknown } | null; setupRequired?: unknown };
    try {
      const res = await d.fetch('/api/v1/auth/status', { signal: abort.signal, credentials: 'same-origin' });
      if (!res.ok) return unchecked;
      status = await res.json();
    } catch {
      return unchecked;
    }
    const display = d.hash.startsWith('#/display') || !!status.user?.display;
    if (!once && (display || !status.user || status.setupRequired)) return paused(display ? 'display' : 'signed-out');
    // d: the template (normally from the browser's cache). A failure is outside the file: not counted.
    try {
      if (!d.template) return unchecked;
      const res = await d.fetch(d.template, { signal: abort.signal, credentials: 'same-origin' });
      if (!res.ok) return unchecked;
      json = await res.text();
    } catch {
      return unchecked;
    }
  } finally {
    clearTimeout(timer);
  }
  let tpl;
  try {
    tpl = readTemplate(json);
  } catch {
    return unchecked;
  }
  // e: the check, with the build's rules, on the text as stored.
  const tag = tagInfo(r.tag, tpl.plurals);
  let result;
  try {
    if (!tag.ok) throw new Error('the tag');
    result = d.check(r.text, false, tpl, tag.value, { full: false });
  } catch {
    const fails = r.fails + 1;
    if (fails >= 2) return removed('failed', r.name);
    write(d.store, { ...r, fails });
    return unchecked;
  }
  if (result.refused || !tag.ok) return removed('damaged', r.name);
  if (r.fails !== 0) write(d.store, { ...r, fails: 0 });
  // f: the table, as a fetched catalog is (re-checked at first use against the literal).
  return {
    choice: { tag: tag.value.tag, table: result.checked.table, dir: tag.value.dir, formatLocale: formatLocale(tag.value.tag, d.languages) },
    view: { kind: 'active', ...named },
    record: r,
  };
}
