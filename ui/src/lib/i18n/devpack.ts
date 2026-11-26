// REQ: API-013 (ADR-190) — what the first load knows about testing a language pack: the one storage
// key, this web UI's build (the entry module's content-hashed file name, set by `main.ts`), the
// address of the build's pair-file template (from the URL table, which only `main.ts` imports), and
// the two hooks the pack's code sets when it runs. The pack's own code loads later, and only when it
// is used.

/** The browser storage key of a test pack (or of the notice that it was removed). */
export const DEVPACK_KEY = 'telltale.devpack';

export const devpack: {
  /** The web UI build: the entry module's path (`/assets/index-<hash>.js`). */
  ui: string;
  /** The build's pair-file template (`/assets/locales/template-<sha8>.json`), or null. */
  template: string | null;
  /** A pack or a notice about one is in this browser (the Settings card then shows in Simple too). */
  active: boolean;
  /** Set by the pack's code: the app's build poll calls it with the server's build commit. */
  onBuild?: (commit: string | undefined) => void;
  /** Set by the pack's code: the page failed to draw with the pack (true: handled, it reloads). */
  failed?: () => boolean;
} = { ui: '', template: null, active: false };
