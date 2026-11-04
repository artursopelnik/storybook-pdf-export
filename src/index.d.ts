import type * as PDFLib from 'pdf-lib';
import type { Page } from 'playwright-core';

export interface Entry {
  id: string;
  title: string;
  name: string;
  type: 'docs' | 'story';
  tags: string[];
  importPath?: string;
}

export interface Theme {
  /** Brand / accent colour. CSS: `var(--pdf-accent)`. Default `#ff4785`. */
  accentColor?: string;
  /** CSS: `var(--pdf-text)`. */
  textColor?: string;
  /** Footer and meta lines. CSS: `var(--pdf-muted)`. */
  mutedColor?: string;
  /** Font stack for the generated pages. CSS: `var(--pdf-font)`. */
  fontFamily?: string;
  /** `@import` / `@font-face` rules for web fonts. */
  fontCss?: string;
  /** Path (relative to the config file) or URL of an svg/png/jpg/webp/gif logo. */
  logo?: string | null;
  /** Locale for the date on the cover, e.g. `de-DE`. */
  locale?: string;
}

export interface TocNode {
  label: string;
  depth: number;
  /** 1-based page number. */
  page: number;
  /** Use as `<a href>`: becomes an internal PDF link. */
  href: string;
  entry: number;
  children: TocNode[];
}

export interface TemplateContext {
  title: string;
  subtitle?: string;
  author?: string;
  version?: string;
  date: Date;
  dateText: string;
  /** Data URI or URL of the logo, if any. */
  logo: string | null;
  theme: Required<Theme>;
  entries: Entry[];
  /** HTML-escapes a value. */
  esc(value: unknown): string;
}

export interface TocContext extends TemplateContext {
  kind: 'toc';
  tree: TocNode[];
  /** `tree` flattened in reading order. */
  items: TocNode[];
}

export interface PageContext extends TemplateContext {
  kind: 'cover' | 'toc' | 'content' | 'back';
  /** 1-based. */
  pageNumber: number;
  total: number;
  /** Entry the page belongs to (content pages only). */
  entry: Entry | null;
  /** "Components › Forms › Button" (content pages only). */
  section: string | null;
}

type Html = string | null | undefined | Promise<string | null | undefined>;

export interface Templates {
  cover?: (ctx: TemplateContext & { kind: 'cover' }) => Html;
  toc?: (ctx: TocContext) => Html;
  header?: (ctx: PageContext) => Html;
  footer?: (ctx: PageContext) => Html;
  back?: (ctx: TemplateContext & { kind: 'back' }) => Html;
  /** Extra CSS for cover, TOC, back page, header and footer. */
  css?: string;
}

export interface Hooks {
  /** Reorder or filter the entries. Return the new list. */
  filterEntries?: (entries: Entry[], index: Entry[]) => Entry[] | void | Promise<Entry[] | void>;
  /** Called after Storybook rendered an entry, right before it is printed. */
  beforeRender?: (args: { page: Page; entry: Entry }) => void | Promise<void>;
  /** Raw PDF of one entry. Return new bytes to replace it. */
  afterRender?: (args: { entry: Entry; pdf: Uint8Array }) => Uint8Array | void | Promise<Uint8Array | void>;
  /** The final document, right before it is saved. */
  beforeSave?: (args: {
    doc: PDFLib.PDFDocument;
    PDFLib: typeof PDFLib;
    entries: Entry[];
    /** 0-based index of the first page of every entry. */
    startPages: number[];
    context: TemplateContext;
  }) => void | Promise<void>;
}

export interface ExportOptions {
  /** Static build directory or URL of a running Storybook. CLI default: `./storybook-static`. */
  source?: string;
  /** Output file. `null` only returns the bytes. Default `storybook.pdf`. */
  output?: string | null;
  title?: string;
  subtitle?: string;
  author?: string;
  /** Shown on the cover. Default: version from package.json. */
  version?: string;
  /** Date on the cover and in the metadata. Default: now. */
  date?: Date | string | number;
  /** Default `auto`: docs pages plus stories of components without docs. */
  mode?: 'auto' | 'docs' | 'stories' | 'all';
  /** Glob patterns on id, title or "title/name". A pattern also matches everything below it. */
  include?: string[];
  exclude?: string[];
  /** Extra print stylesheets (paths). */
  css?: string[];
  /** Paper format, e.g. `A4`, `Letter`. Default `A4`. */
  format?: string;
  landscape?: boolean;
  margin?: { top?: string; right?: string; bottom?: string; left?: string };
  cover?: boolean;
  toc?: boolean;
  pageNumbers?: boolean;
  /** Public Storybook URL. Links to stories that are not in the PDF point there. */
  storybookUrl?: string;
  /**
   * Browser to print with. `auto` (default) uses Playwright's Chromium if it is
   * installed, otherwise Google Chrome, otherwise Microsoft Edge. Any other
   * Playwright channel name (e.g. `chrome-beta`, `msedge-dev`) works too.
   * Env: STORYBOOK_PDF_BROWSER.
   */
  browser?: 'auto' | 'chromium' | 'chrome' | 'msedge' | (string & {});
  /** Path to a Chrome / Chromium / Edge binary. Wins over `browser`. Env: STORYBOOK_PDF_BROWSER_PATH. */
  browserPath?: string;
  /** @deprecated Use `browserPath`. */
  chromium?: string;
  /**
   * Build the Storybook first? Default (unset): only if `source` has no build
   * but a `.storybook` folder exists. `true`: always build, `false`: never.
   */
  build?: boolean;
  /** Storybook config folder used for building. Default `.storybook`. */
  configDir?: string;
  /**
   * Fixed port for the local server that serves a static build. Default 0
   * (a random free port). Useful when company policies only let the browser
   * reach certain local ports.
   */
  port?: number;
  /**
   * Print every tab of tab sets (`role="tablist"` / `role="tab"`), one after
   * another under its label, instead of only the active one. Default true.
   * Opt out per tab set with the class `sb-print-no-fit`.
   */
  expandTabs?: boolean;
  /** Pages rendered in parallel. Default 4. */
  concurrency?: number;
  /** Per-page timeout in ms. Default 30000. */
  timeout?: number;
  /** Extra wait per page in ms. */
  delay?: number;
  /** Throw if any entry fails to render. */
  strict?: boolean;
  theme?: Theme;
  templates?: Templates;
  hooks?: Hooks;
  /** Base directory for relative paths. Default: `process.cwd()` (the config file's folder in the CLI). */
  cwd?: string;
  log?: (message: string) => void;
  warn?: (message: string) => void;
}

export interface ExportResult {
  bytes: Uint8Array;
  pages: number;
  entries: Entry[];
  failed: { entry: Entry; error: Error }[];
}

export function exportPdf(options: ExportOptions): Promise<ExportResult>;
export function defineConfig(config: ExportOptions | (() => ExportOptions | Promise<ExportOptions>)): typeof config;

export function normaliseIndex(json: unknown): Entry[];
export function selectEntries(entries: Entry[], options?: Pick<ExportOptions, 'mode' | 'include' | 'exclude'>): Entry[];

export const DEFAULTS: Readonly<Required<Pick<ExportOptions, 'output' | 'mode' | 'format' | 'landscape' | 'cover' | 'toc' | 'pageNumbers' | 'concurrency' | 'timeout' | 'delay' | 'strict' | 'expandTabs' | 'port'>>>;
export const HOOKS: readonly string[];
export const PRINT_CSS_PATH: string;
export function esc(value: unknown): string;

/** The default templates, to build on in your own. */
export const templates: {
  cover(ctx: TemplateContext): string;
  toc(ctx: TocContext): string;
  header(ctx: PageContext): string;
  footer(ctx: PageContext): string;
  back(ctx: TemplateContext): string;
  DEFAULT_THEME: Required<Theme>;
  BASE_CSS: string;
};
