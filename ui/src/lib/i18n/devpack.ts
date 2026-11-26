// REQ: API-013 (ADR-190) — what the first load knows about testing a language pack: the one storage
// key, this web UI's build (the entry module's content-hashed file name, set by `main.ts`), the
// address of the build's pair-file template (from the URL table, which only `main.ts` imports), and
// one hook the app's build poll calls. The pack's own code loads later, and only when it is used.

/** The browser storage key of a test pack (or of the notice that it was removed). */
export const DEVPACK_KEY = 'telltale.devpack';

export const devpack = {
  /** The web UI build: the entry module's path (`/assets/index-<hash>.js`). */
  ui: '',
  /** The build's pair-file template (`/assets/locales/template-<sha8>.json`), or null. */
  template: null as string | null,
  /** A pack or a notice about one is in this browser (the Settings card then shows in Simple too). */
  active: false,
};

let onBuild: ((commit: string) => void) | undefined;

/** Registered by the pack's code: called with the server's build commit after each `/system/info`. */
export function onServerBuild(f: (commit: string) => void): void {
  onBuild = f;
}

/** The app's build poll: the server's build commit. Nothing happens without a pack. */
export function serverBuild(commit: string | undefined): void {
  if (commit) onBuild?.(commit);
}
