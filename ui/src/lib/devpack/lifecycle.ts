// REQ: API-013 (ADR-190) — what a page load does with the test language pack this browser keeps,
// before the page is drawn (design: "At start-up"):
//   a. a notice (the pack was removed) is shown until dismissed, 7 days at most;
//   b. another web UI build, 7 days gone (by a clock that runs either way), or a value that is not a record
//      removes the pack, with a notice;
//   c. `?lang=` pauses it for this load; so does a page where nobody is signed in (sign-in, two-factor,
//      setup, a server that cannot be reached), a display link and a display session, and a user other
//      than the one who loaded it, unless "Show the test pack on this page" asked for this one load (that
//      flag is taken first, whatever the load decides); and so does the load after the pack left a page
//      because someone went away;
//   d. the table the check gave is installed as it was kept, while the web UI build and the file's
//      fingerprint it was made for are this record's (design section 8, "About the boot ceiling");
//   e. otherwise the template is fetched (a failure: the usual language, and the pack stays for the next
//      load) and the file is checked again with the build's rules (a check that throws twice in a row
//      retires it), and the record keeps the new table, in the same one write;
//   f. the table is installed as the page's language (the runtime re-checks each translation against its
//      English the first time it shows it, as for a catalog the build did not ship).
// It writes over or removes only what it read, while the key still holds it (another tab may have loaded a
// newer pack), and gives up the requests and the checking code when the page load stops waiting. Pure:
// storage, network, time and the checking code (loaded only for e) come in `Deps`, so the tests hold
// every path.
import type { Choice } from '../i18n';
import { formatLocale } from '../i18n/match';
import type { checkPack, tagInfo } from '../i18n/pack';
import type { readTemplate } from '../i18n/template';
import { keptTable, lifetime, notice, readValue, retire, rewrite, stale, type Gone, type Held, type Notice, type PackRecord, type Store } from './store';

/** Why a pack is paused: nobody signed in, a display, `?lang=`, or someone other than who loaded it. */
export type Paused = 'signed-out' | 'display' | 'param' | 'user';
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
  /** Reads and removes the one-load flag: `1` after "Show the test pack on this page" (this load shows the
   * pack where it would pause), `away` after the pack left a page because someone went away (this load is
   * paused, whoever the status says is signed in). */
  readonly takeOnce: () => string | null;
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
  /** Ends when the page load stops waiting for the pack (the catalog's limit, from the start of its code):
   * the requests and the checking code are given up then, and the page is in the usual language. */
  readonly signal: AbortSignal;
};

/** The page's language from the pack (null: the usual language), what the banner shows, the record that
 * still applies (null when there is none, or it was just removed), the notice shown, and whether the file was
 * checked. `user`: who is signed in on this load (null: nobody), once the status was read; `shown`: "Show the
 * test pack on this page" lifted a pause for this one load. */
export type Decision = {
  readonly choice: Choice | null;
  readonly view: View;
  readonly record: PackRecord | null;
  readonly notice?: Notice;
  readonly paused?: Paused;
  readonly checked?: boolean;
  readonly user?: string | null;
  readonly shown?: boolean;
};

const NONE: Decision = { choice: null, view: { kind: 'none' }, record: null };

/** `p`, or a rejection when `signal` ends first (an import cannot be aborted, only given up). */
const until = <T>(p: Promise<T>, signal: AbortSignal) =>
  Promise.race([p, new Promise<never>((_, no) => (signal.aborted ? no(signal.reason) : signal.addEventListener('abort', () => no(signal.reason), { once: true })))]);

export async function decide(value: string, d: Deps): Promise<Decision> {
  // The one-load flag is taken first, so that no early return leaves it for a later page.
  const flag = d.takeOnce();
  const once = flag === '1';
  const now = d.now();
  const got = readValue(value);
  // What this load read is removed (or written over) only while the key still holds it.
  const removed = (gone: Gone, name: string, ref: Held): Decision => {
    const n = notice(gone, name, now);
    retire(d.store, ref, n);
    return { choice: null, view: { kind: 'notice', gone, name }, record: null, notice: n };
  };
  // a, b: a notice, a value that is not a record, another build, 7 days (by a clock that runs either way).
  if ('damaged' in got) return removed('damaged', '', value);
  if ('notice' in got) {
    if (stale(got.notice.at, now)) {
      retire(d.store, got.notice);
      return NONE;
    }
    return { choice: null, view: { kind: 'notice', gone: got.notice.gone, name: got.notice.name }, record: null, notice: got.notice };
  }
  const r = got.record;
  const gone = lifetime(r, d.ui, now);
  if (gone) return removed(gone, r.name, r);
  const named: Named = { name: r.name, sha: r.sha, tag: r.tag };
  const paused = (why: Paused, user?: string | null): Decision => ({ choice: null, view: { kind: 'paused', why, ...named }, record: r, paused: why, user });
  const unchecked: Decision = { choice: null, view: { kind: 'unchecked', ...named }, record: r };
  let user: string | null = null;
  let shown = false;
  const use = (table: NonNullable<Choice['table']>, checked: boolean): Decision => ({
    choice: { tag: r.tag, table, dir: r.dir, formatLocale: formatLocale(r.tag, d.languages) },
    view: { kind: 'active', ...named },
    record: r,
    checked,
    user,
    shown,
  });
  // c: `?lang=` is this load's language.
  if (new URLSearchParams(d.search).has('lang')) return paused('param');
  let json: string;
  let code: Checker;
  // c: who is signed in (the public status the app reads anyway).
  let status: { user?: { display?: unknown; username?: unknown } | null; setupRequired?: unknown };
  try {
    const res = await d.fetch('/api/v1/auth/status', { signal: d.signal, credentials: 'same-origin' });
    if (!res.ok) return unchecked;
    status = await res.json();
  } catch {
    return unchecked;
  }
  user = status.user ? String(status.user.username ?? '') : null;
  const display = d.hash.startsWith('#/display') || !!status.user?.display;
  // After the pack left a page because someone went away, this load is paused whatever the status says (a
  // status that disagrees with the app's own requests never makes the page reload again and again).
  const why: Paused | null = display ? 'display' : !status.user || status.setupRequired || flag === 'away' ? 'signed-out' : user !== r.user ? 'user' : null;
  if (why && !once) return paused(why, user);
  shown = !!why;
  // d: the table kept for this build and this file.
  const kept = r.checked && r.checked.ui === d.ui && r.checked.sha === r.sha ? keptTable(r.checked.table) : null;
  if (kept) return use(kept, false);
  // e: the template (normally from the browser's cache) and the checking code. A failure of either, or the
  // page load's time running out, is outside the file: not counted.
  try {
    if (!d.template) return unchecked;
    const [res, c] = await Promise.all([d.fetch(d.template, { signal: d.signal, credentials: 'same-origin' }), until(d.checker(), d.signal)]);
    if (!res.ok) return unchecked;
    json = await res.text();
    code = c;
  } catch {
    return unchecked;
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
    if (fails >= 2) return removed('failed', r.name, r);
    rewrite(d.store, r, { ...r, fails, checked: undefined });
    return unchecked;
  }
  if (result.refused || !tag.ok) return removed('damaged', r.name, r);
  // The record keeps the new table, in its one write (a store that is full keeps the record as it was).
  rewrite(d.store, r, { ...r, fails: 0, checked: { ui: d.ui, sha: r.sha, table: result.checked.table } });
  return use(result.checked.table, true);
}
