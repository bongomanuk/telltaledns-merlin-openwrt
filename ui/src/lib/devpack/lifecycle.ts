// REQ: API-013 (ADR-190) — what a page load does with the test language pack this browser keeps,
// before the page is drawn (design: "At start-up"):
//   a. a notice (the pack was removed) is shown until dismissed, 7 days at most;
//   b. another web UI build, 7 days gone, or a value that is not a record removes the pack, with a notice;
//   c. `?lang=` pauses it for this load; so does a page where nobody is signed in (sign-in, two-factor,
//      setup, a server that cannot be reached), a display link and a display session, unless "Show the
//      test pack on this page" asked for this one load (that flag is taken first, whatever the load
//      decides);
//   d. the table the check gave is installed as it was kept, while the web UI build and the file's
//      fingerprint it was made for are this record's (design section 8, "About the boot ceiling");
//   e. otherwise the template is fetched (a failure: the usual language, and the pack stays for the next
//      load) and the file is checked again with the build's rules (a check that throws twice in a row
//      retires it), and the record keeps the new table, in the same one write;
//   f. the table is installed as the page's language (the runtime re-checks each translation against its
//      English the first time it shows it, as for a catalog the build did not ship).
// Pure: storage, network, time and the checking code (loaded only for e) come in `Deps`, so the tests
// hold every path.
import type { Choice } from '../i18n';
import { formatLocale } from '../i18n/match';
import type { checkPack, tagInfo } from '../i18n/pack';
import type { readTemplate } from '../i18n/template';
import { LIFETIME_MS, forget, keptTable, lifetime, notice, readValue, write, type Gone, type PackRecord, type Store } from './store';

export type Paused = 'signed-out' | 'display' | 'param';
type Named = { readonly name: string; readonly sha: string; readonly tag: string };
/** What the banner shows. */
export type View =
  | { readonly kind: 'none' }
  | { readonly kind: 'notice'; readonly gone: Gone; readonly name: string }
  | ({ readonly kind: 'active' | 'unchecked' | 'updated' | 'signed-in' } & Named)
  | ({ readonly kind: 'paused'; readonly why: Paused } & Named);

/** The checking code: the template's reader, the tag's rules, the check. */
export type Checker = { readonly readTemplate: typeof readTemplate; readonly tagInfo: typeof tagInfo; readonly checkPack: typeof checkPack };

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
  /** Loads the checking code (a chunk of its own in the browser): only when the file is checked. */
  readonly checker: () => Promise<Checker>;
  /** For the two requests together (the catalog's limit). */
  readonly timeoutMs: number;
};

/** The page's language from the pack (null: the usual language), what the banner shows, the record that
 * still applies (null when there is none, or it was just removed), and whether the file was checked. */
export type Decision = { readonly choice: Choice | null; readonly view: View; readonly record: PackRecord | null; readonly paused?: Paused; readonly checked?: boolean };

const NONE: Decision = { choice: null, view: { kind: 'none' }, record: null };

export async function decide(value: string, d: Deps): Promise<Decision> {
  // The one-load flag is taken first, so that no early return leaves it for a later page.
  const once = d.takeOnce();
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
  const use = (table: NonNullable<Choice['table']>, checked: boolean): Decision => ({
    choice: { tag: r.tag, table, dir: r.dir, formatLocale: formatLocale(r.tag, d.languages) },
    view: { kind: 'active', ...named },
    record: r,
    checked,
  });
  // c: `?lang=` is this load's language.
  if (new URLSearchParams(d.search).has('lang')) return paused('param');
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), d.timeoutMs);
  let json: string;
  let code: Checker;
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
    // d: the table kept for this build and this file.
    const kept = r.checked && r.checked.ui === d.ui && r.checked.sha === r.sha ? keptTable(r.checked.table) : null;
    if (kept) return use(kept, false);
    // e: the template (normally from the browser's cache) and the checking code. A failure of either is
    // outside the file: not counted.
    try {
      if (!d.template) return unchecked;
      const [res, c] = await Promise.all([d.fetch(d.template, { signal: abort.signal, credentials: 'same-origin' }), d.checker()]);
      if (!res.ok) return unchecked;
      json = await res.text();
      code = c;
    } catch {
      return unchecked;
    }
  } finally {
    clearTimeout(timer);
  }
  let tpl;
  try {
    tpl = code.readTemplate(json);
  } catch {
    return unchecked;
  }
  // e: the check, with the build's rules, on the text as stored.
  const tag = code.tagInfo(r.tag, tpl.plurals);
  let result;
  try {
    if (!tag.ok) throw new Error('the tag');
    result = code.checkPack(r.text, false, tpl, tag.value, { full: false });
  } catch {
    const fails = r.fails + 1;
    if (fails >= 2) return removed('failed', r.name);
    write(d.store, { ...r, fails, checked: undefined });
    return unchecked;
  }
  if (result.refused || !tag.ok) return removed('damaged', r.name);
  // The record keeps the new table, in its one write (a store that is full keeps the record as it was).
  write(d.store, { ...r, fails: 0, checked: { ui: d.ui, sha: r.sha, table: result.checked.table } });
  return use(result.checked.table, true);
}
