import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as PDFLib from 'pdf-lib';

import { serveStatic } from './server.js';
import { launchBrowser } from './browser.js';
import { buildStorybook, findConfigDir } from './build.js';
import { normaliseIndex, selectEntries, buildTree, assertMode } from './entries.js';
import * as defaults from './templates.js';
import { DEFAULT_THEME, DEFAULT_TEMPLATES, PAGE_LINK, documentHtml, overlayHtml, resolveLogo, esc } from './templates.js';
import { listenForRender, renderEntry, renderHtml } from './render.js';
import { merge, applyOverlay, pageCount, startPages, rewriteLinks, pageIndexById, addOutline } from './pdf.js';
import { NO_MARGIN, isUrl, firstLine, formatTitle, entryLabel, plural, readProjectPackage, printableWidth } from './util.js';

const { PDFDocument } = PDFLib;

export { normaliseIndex, selectEntries, buildTree } from './entries.js';
export { defaults as templates, esc };

/** Identity helper for typed / documented config files. */
export const defineConfig = (config) => config;

export const HOOKS = ['filterEntries', 'beforeRender', 'afterRender', 'beforeSave'];

export const PRINT_CSS_PATH = join(dirname(fileURLToPath(import.meta.url)), 'print.css');

export const DEFAULTS = Object.freeze({
  output: 'storybook.pdf',
  mode: 'auto',
  format: 'A4',
  landscape: false,
  margin: Object.freeze({ top: '18mm', right: '16mm', bottom: '20mm', left: '16mm' }),
  cover: true,
  toc: true,
  pageNumbers: true,
  concurrency: 4,
  timeout: 30_000,
  delay: 0,
  include: [],
  exclude: [],
  css: [],
  strict: false,
  browser: 'auto',
  configDir: '.storybook',
  expandTabs: true,
  port: 0,
});

/**
 * Renders a Storybook into a single PDF.
 *
 * @param {import('./index').ExportOptions} opts
 * @returns {Promise<import('./index').ExportResult>}
 */
export async function exportPdf(opts = {}) {
  const o = normaliseOptions(opts);
  const log = o.log;

  const source = await openSource(o);
  const { base } = source;

  let browser;
  try {
    // ---- 0. Decide what goes into the PDF -----------------------------------
    const index = await loadIndex(base);
    let entries = selectEntries(index, o);
    if (o.hooks.filterEntries) entries = (await o.hooks.filterEntries(entries, index)) ?? entries;
    if (!entries.length) throw new Error('No docs pages or stories matched the given filters.');
    log(`Found ${plural(index.length, 'index entry', 'index entries')}, exporting ${entries.length}.`);

    const pkg = source.projectDir ? await readProjectPackage(source.projectDir) : {};
    const css = await buildPrintCss(o);
    const theme = { ...DEFAULT_THEME, ...o.theme };
    theme.logo = await resolveLogo(theme.logo, o.cwd);
    const templates = { ...DEFAULT_TEMPLATES, ...o.templates };
    if (!o.pageNumbers && !o.templates?.footer) templates.footer = () => '';

    ({ browser } = await launchBrowser({ browser: o.browser, browserPath: o.browserPath, log }));
    // Lay pages out at the width they will have on paper, so responsive
    // components and the scroll-container fitting see the real space.
    const printWidth = printableWidth(o);
    const context = await browser.newContext({ viewport: { width: printWidth, height: 1000 }, deviceScaleFactor: 1 });
    context.setDefaultTimeout(o.timeout);
    context.setDefaultNavigationTimeout(o.timeout);

    const pdfOptions = { format: o.format, landscape: o.landscape, margin: o.margin, printBackground: true };

    // ---- 1. Render every entry ----------------------------------------------
    const { parts, failed } = await renderEntries(context, { base, entries, css, pdfOptions, printWidth, o });
    if (failed.length && o.strict) {
      throw new Error(`${plural(failed.length, 'entry', 'entries')} failed to render:\n` +
        failed.map((f) => `  - ${entryLabel(f.entry)}: ${firstLine(f.error)}`).join('\n'));
    }
    if (!parts.length) throw new Error('Nothing could be rendered.');

    const okEntries = parts.map((p) => p.entry);
    const contentDocs = parts.map((p) => p.doc);
    const tree = buildTree(okEntries);
    const date = o.date;
    const ctx = {
      title: o.title ?? pkg.name ?? 'Storybook',
      subtitle: o.subtitle,
      author: o.author,
      version: o.version ?? pkg.version,
      date,
      dateText: date.toLocaleDateString(theme.locale, { year: 'numeric', month: 'long', day: 'numeric' }),
      logo: theme.logo,
      theme,
      entries: okEntries,
      esc,
    };

    // ---- 2. Front & back matter -------------------------------------------------
    const page = await context.newPage();
    try {
      const renderTemplate = async (name, extra) => {
        let body;
        try {
          body = await templates[name]({ ...ctx, ...extra });
        } catch (err) {
          throw new Error(`Template "${name}" failed: ${err.message}`, { cause: err });
        }
        if (!body) return null;
        const fullBleed = name === 'cover';
        const html = documentHtml(body, { printCss: css, theme, templateCss: templates.css, margin: o.margin, fullBleed });
        const doc = await PDFDocument.load(await renderHtml(page, html, fullBleed ? { ...pdfOptions, margin: NO_MARGIN } : pdfOptions));
        // A cover is one page, whatever a custom template does.
        if (name === 'cover' && doc.getPageCount() > 1) {
          o.warn(`⚠ The cover template produced ${doc.getPageCount()} pages; only the first one is used.`);
          while (doc.getPageCount() > 1) doc.removePage(doc.getPageCount() - 1);
        }
        return doc;
      };

      const cover = o.cover ? await renderTemplate('cover', { kind: 'cover' }) : null;
      const toc = o.toc ? await renderToc(renderTemplate, { tree, contentDocs, before: cover ? cover.getPageCount() : 0 }) : null;
      const back = await renderTemplate('back', { kind: 'back' });

      // ---- 3. Merge -------------------------------------------------------------
      const sections = [
        ...(cover ? [{ kind: 'cover', doc: cover }] : []),
        ...(toc ? [{ kind: 'toc', doc: toc }] : []),
        ...parts.map((p) => ({ kind: 'content', doc: p.doc, entry: p.entry })),
        ...(back ? [{ kind: 'back', doc: back }] : []),
      ];
      const out = await merge(sections.map((s) => s.doc));
      const starts = startPages(contentDocs, pageCount([cover, toc].filter(Boolean)));

      // ---- 4. Running header / footer --------------------------------------------
      const pageInfo = sections.flatMap((s) => s.doc.getPageIndices().map(() => s));
      await addRunningHeaders(out, { page, pageInfo, templates, ctx, theme, margin: o.margin });

      // ---- 5. Links, bookmarks, metadata -----------------------------------------
      const links = rewriteLinks(out, { base, idToPage: pageIndexById(okEntries, starts), storybookUrl: o.storybookUrl });
      if (links.removed) log(`  ${plural(links.removed, 'link', 'links')} to stories outside the PDF made non-clickable (pass --storybook-url to keep them).`);
      addOutline(out, tree, starts);
      setMetadata(out, ctx);

      if (o.hooks.beforeSave) await o.hooks.beforeSave({ doc: out, PDFLib, entries: okEntries, startPages: starts, context: ctx });

      const bytes = await out.save();
      if (o.output) {
        const file = resolve(o.cwd, o.output);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, bytes);
      }
      return { bytes, pages: out.getPageCount(), entries: okEntries, failed };
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    await browser?.close().catch(() => {});
    await source.close();
  }
}

// ---------------------------------------------------------------------------

const KNOWN_OPTIONS = new Set([
  ...Object.keys(DEFAULTS),
  'source', 'title', 'subtitle', 'author', 'version', 'date', 'theme', 'templates', 'hooks',
  'storybookUrl', 'browserPath', 'chromium', 'build', 'cwd', 'log', 'warn',
]);

function normaliseOptions(opts) {
  // `undefined` means "not set" so it never overrides a default.
  const given = Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined));
  const warn = given.warn ?? ((msg) => console.warn(msg));
  for (const key of Object.keys(given)) {
    if (!KNOWN_OPTIONS.has(key)) warn(`⚠ Unknown option "${key}" is ignored.`);
  }
  for (const key of Object.keys(given.theme ?? {})) {
    if (!(key in DEFAULT_THEME)) warn(`⚠ Unknown theme option "${key}" is ignored.`);
  }
  for (const key of Object.keys(given.hooks ?? {})) {
    if (!HOOKS.includes(key)) warn(`⚠ Unknown hook "${key}" is ignored.`);
  }
  const o = {
    ...DEFAULTS,
    ...given,
    margin: { ...DEFAULTS.margin, ...given.margin },
    hooks: given.hooks ?? {},
    cwd: given.cwd ?? process.cwd(),
    log: given.log ?? (() => {}),
    warn,
    date: given.date == null ? new Date() : new Date(given.date),
  };

  // `chromium` and STORYBOOK_PDF_CHROMIUM are the old names of browserPath.
  o.browserPath = given.browserPath ?? given.chromium ?? process.env.STORYBOOK_PDF_BROWSER_PATH ?? process.env.STORYBOOK_PDF_CHROMIUM;
  if (given.browser === undefined && process.env.STORYBOOK_PDF_BROWSER) o.browser = process.env.STORYBOOK_PDF_BROWSER;
  if (o.build !== undefined && typeof o.build !== 'boolean') throw new Error('"build" must be true, false or left out (auto).');

  if (!o.source) throw new Error('No Storybook source given.');
  assertMode(o.mode);
  if (Number.isNaN(o.date.getTime())) throw new Error(`Invalid date: ${given.date}`);
  for (const key of ['include', 'exclude', 'css']) {
    if (!Array.isArray(o[key])) o[key] = [o[key]];
  }
  for (const key of ['concurrency', 'timeout', 'delay']) {
    if (!Number.isFinite(o[key]) || o[key] < 0) throw new Error(`"${key}" must be a non-negative number.`);
  }
  o.concurrency = Math.max(1, Math.floor(o.concurrency));
  if (!Number.isInteger(o.port) || o.port < 0 || o.port > 65535) throw new Error('"port" must be a whole number between 0 and 65535 (0 = random).');
  printableWidth(o); // throws on unknown formats / margin units before anything starts
  for (const [name, fn] of Object.entries(o.hooks)) {
    if (typeof fn !== 'function') throw new Error(`Hook "${name}" must be a function.`);
  }
  for (const [name, value] of Object.entries(o.templates ?? {})) {
    if (!(name in DEFAULT_TEMPLATES)) {
      warn(`⚠ Unknown template "${name}" is ignored.`);
      continue;
    }
    const ok = name === 'css' ? typeof value === 'string' : typeof value === 'function';
    if (!ok) throw new Error(`Template "${name}" must be ${name === 'css' ? 'a string' : 'a function'}.`);
  }
  return o;
}

/**
 * Where the Storybook comes from:
 *   - a URL of a running Storybook
 *   - a static build (storybook-static), served on a random local port
 *   - nothing built yet: `storybook build` into a temporary folder first
 *     (`build: true` always rebuilds, `build: false` never builds)
 */
async function openSource(o) {
  if (isUrl(o.source)) {
    return { base: o.source.replace(/\/?(index\.html|iframe\.html)?([?#].*)?$/, '/'), projectDir: null, close: async () => {} };
  }

  const dir = resolve(o.cwd, o.source);
  const isBuild = existsSync(join(dir, 'iframe.html'));
  if (isBuild && o.build !== true) {
    const server = await serveStatic(dir, { port: o.port });
    return { base: server.url, projectDir: dir, close: server.close };
  }

  const configDir = findConfigDir(o.cwd, o.configDir);
  if (o.build === false || !configDir) {
    throw new Error(
      `"${dir}" does not look like a Storybook build (no iframe.html)` +
        (o.build === false ? '.' : `, and there is no ${o.configDir} folder in ${o.cwd} to build one from.`) +
        ' Run "storybook build" first, pass the build folder, or the URL of a running Storybook.',
    );
  }
  const build = await buildStorybook({ cwd: o.cwd, configDir: o.configDir, log: o.log });
  const server = await serveStatic(build.dir, { port: o.port });
  return {
    base: server.url,
    // The project's package.json sits next to where storybook-static would be.
    projectDir: join(o.cwd, 'storybook-static'),
    close: async () => {
      await server.close();
      await build.cleanup();
    },
  };
}

async function loadIndex(base) {
  for (const file of ['index.json', 'stories.json']) {
    const res = await fetch(new URL(file, base)).catch(() => null);
    if (res?.ok) return normaliseIndex(await res.json());
  }
  throw new Error(`Could not load index.json from ${base}`);
}

async function buildPrintCss(o) {
  const m = o.margin;
  return [
    await readFile(PRINT_CSS_PATH, 'utf8'),
    // CSS @page beats Playwright's margin option, so state the configured margins here.
    `@page { margin: ${m.top} ${m.right} ${m.bottom} ${m.left}; }`,
    ...(await Promise.all(o.css.map((f) => readFile(resolve(o.cwd, f), 'utf8')))),
  ].join('\n');
}

/**
 * Renders all entries with `concurrency` pages in parallel. A failing entry is
 * recorded and skipped; its page is replaced in case the renderer crashed.
 */
async function renderEntries(context, { base, entries, css, pdfOptions, printWidth, o }) {
  const rendered = new Array(entries.length);
  const failed = [];
  let next = 0;
  let done = 0;

  const newPage = async () => {
    const page = await context.newPage();
    await page.addInitScript(listenForRender);
    return page;
  };

  const worker = async () => {
    let page = await newPage();
    try {
      while (next < entries.length) {
        const i = next++;
        const entry = entries[i];
        try {
          let pdf = await renderEntry(page, { base, entry, css, pdfOptions, printWidth, delay: o.delay, expandTabs: o.expandTabs, beforeRender: o.hooks.beforeRender, warn: o.warn });
          if (o.hooks.afterRender) pdf = (await o.hooks.afterRender({ entry, pdf })) ?? pdf;
          rendered[i] = await PDFDocument.load(pdf);
        } catch (error) {
          failed.push({ entry, error });
          o.log(`  ✗ ${entryLabel(entry)}: ${firstLine(error)}`);
          await page.close().catch(() => {});
          page = await newPage();
        }
        o.log(`  [${++done}/${entries.length}] ${entryLabel(entry)}`);
      }
    } finally {
      await page.close().catch(() => {});
    }
  };

  await Promise.all(Array.from({ length: Math.min(o.concurrency, entries.length) }, worker));
  const parts = entries.map((entry, i) => ({ entry, doc: rendered[i] })).filter((p) => p.doc);
  return { parts, failed };
}

/**
 * The TOC lists page numbers that depend on its own length. Render it until
 * its page count is stable (normally twice: once to measure, once for real).
 */
async function renderToc(renderTemplate, { tree, contentDocs, before }) {
  const tocContext = (starts) => {
    const nodes = tocTree(tree, starts);
    return { kind: 'toc', tree: nodes, items: flatten(nodes) };
  };
  let tocPages = 1;
  for (let attempt = 0; attempt < 4; attempt++) {
    const doc = await renderTemplate('toc', tocContext(startPages(contentDocs, before + tocPages)));
    if (!doc) return null;
    if (doc.getPageCount() === tocPages) return doc;
    tocPages = doc.getPageCount();
  }
  throw new Error('The table of contents does not settle on a page count.');
}

/** Decorates the sidebar tree with page numbers and link targets for TOC templates. */
function tocTree(nodes, starts, depth = 0) {
  return nodes.map((n) => ({
    label: n.label,
    depth,
    page: starts[n.entry] + 1,
    href: `${PAGE_LINK}${starts[n.entry]}`,
    entry: n.entry,
    children: tocTree(n.children, starts, depth + 1),
  }));
}

function flatten(nodes) {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

/** Renders header + footer templates for every page and lays them over the PDF. */
async function addRunningHeaders(out, { page, pageInfo, templates, ctx, theme, margin }) {
  const total = out.getPageCount();
  const html = await Promise.all(
    pageInfo.map(async ({ kind, entry }, i) => {
      const pageCtx = { ...ctx, kind, pageNumber: i + 1, total, entry: entry ?? null, section: entry ? formatTitle(entry.title) : null };
      const parts = [];
      for (const name of ['header', 'footer']) {
        try {
          parts.push((await templates[name](pageCtx)) ?? '');
        } catch (err) {
          throw new Error(`Template "${name}" failed on page ${i + 1}: ${err.message}`, { cause: err });
        }
      }
      return parts.join('');
    }),
  );

  const targets = html.flatMap((h, i) => (h ? [i] : []));
  if (!targets.length) return;
  const { width, height } = out.getPage(0).getSize();
  const overlay = overlayHtml(html, { widthPt: width, heightPt: height, margin, theme, templateCss: templates.css });
  const bytes = await renderHtml(page, overlay, { preferCSSPageSize: true, printBackground: true, margin: NO_MARGIN });
  await applyOverlay(out, bytes, targets);
}

function setMetadata(out, ctx) {
  out.setTitle(ctx.title, { showInWindowTitleBar: true });
  if (ctx.subtitle) out.setSubject(ctx.subtitle);
  if (ctx.author) out.setAuthor(ctx.author);
  out.setCreator('storybook-pdf-export');
  out.setProducer('storybook-pdf-export (Playwright + pdf-lib)');
  out.setCreationDate(ctx.date);
  out.setModificationDate(ctx.date);
}
