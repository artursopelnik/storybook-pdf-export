import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as PDFLib from 'pdf-lib';

import { serveStatic } from './server.js';
import { normaliseIndex, selectEntries, buildTree } from './entries.js';
import * as defaults from './templates.js';
import { DEFAULT_THEME, DEFAULT_TEMPLATES, PAGE_LINK, documentHtml, overlayHtml, resolveLogo, esc } from './templates.js';

const { PDFDocument, PDFName, PDFString, PDFHexString, PDFDict, PDFArray } = PDFLib;

export { normaliseIndex, selectEntries, buildTree } from './entries.js';
export { defaults as templates, esc };

/** Identity helper for typed / documented config files. */
export const defineConfig = (config) => config;

const here = dirname(fileURLToPath(import.meta.url));
export const PRINT_CSS_PATH = join(here, 'print.css');

export const DEFAULTS = {
  output: 'storybook.pdf',
  mode: 'auto',
  format: 'A4',
  landscape: false,
  margin: { top: '18mm', right: '16mm', bottom: '20mm', left: '16mm' },
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
};

const noop = () => {};

/**
 * Renders a Storybook into a single PDF.
 *
 * @param {object} opts
 * @param {string} opts.source        Path to a static build (storybook-static) or URL of a running Storybook.
 * @param {string} [opts.output]      Output file. Pass `null` to only get the bytes back.
 * @param {string} [opts.title]       Document title (cover, metadata). Defaults to the package name.
 * @param {string} [opts.subtitle]
 * @param {'auto'|'docs'|'stories'|'all'} [opts.mode]
 * @param {string[]} [opts.include]   Glob patterns on id / title / "title/name".
 * @param {string[]} [opts.exclude]
 * @param {string[]} [opts.css]       Extra stylesheets (paths) injected after print.css.
 * @param {string} [opts.chromium]  Path to a Chrome/Chromium binary (else Playwright's own; env STORYBOOK_PDF_CHROMIUM).
 * @param {string} [opts.storybookUrl] Public URL of the Storybook; links to other stories that are
 *                                    not part of the PDF point there instead of the temporary server.
 * @param {object} [opts.theme]     Corporate design: accentColor, textColor, mutedColor, fontFamily, fontCss, logo, locale.
 * @param {object} [opts.templates] Own HTML templates: cover, toc, header, footer, back (ctx => html) and css.
 * @param {object} [opts.hooks]     Lifecycle hooks: filterEntries, beforeRender, afterRender, beforeSave.
 * @returns {Promise<{ bytes: Uint8Array, pages: number, entries: object[], failed: object[] }>}
 */
export async function exportPdf(opts) {
  const given = Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined));
  const o = { ...DEFAULTS, ...given, margin: { ...DEFAULTS.margin, ...given.margin } };
  const log = o.log ?? noop;

  if (!o.source) throw new Error('No Storybook source given.');

  let server;
  let base;
  if (/^https?:\/\//i.test(o.source)) {
    base = o.source.replace(/\/?(index\.html|iframe\.html)?(\?.*)?$/, '/');
  } else {
    const dir = resolve(o.source);
    if (!existsSync(join(dir, 'iframe.html'))) {
      throw new Error(`"${dir}" does not look like a Storybook build (no iframe.html). Run "storybook build" first.`);
    }
    server = await serveStatic(dir);
    base = server.url;
  }

  const { chromium } = await import('playwright');
  let browser;

  try {
    const index = await loadIndex(base);
    let entries = selectEntries(index, o);
    if (o.hooks?.filterEntries) entries = (await o.hooks.filterEntries(entries, index)) ?? entries;
    if (!entries.length) throw new Error('No docs pages or stories matched the given filters.');
    log(`Found ${index.length} index entries, exporting ${entries.length}.`);

    const title = o.title ?? (await guessTitle(o.source));
    const m = o.margin;
    const css = [
      await readFile(PRINT_CSS_PATH, 'utf8'),
      // CSS @page beats Playwright's margin option, so state the configured margins here.
      `@page { margin: ${m.top} ${m.right} ${m.bottom} ${m.left}; }`,
      ...(await Promise.all(o.css.map((f) => readFile(resolve(o.cwd ?? '.', f), 'utf8')))),
    ].join('\n');
    const theme = { ...DEFAULT_THEME, ...o.theme };
    theme.logo = await resolveLogo(theme.logo, o.cwd);
    const templates = { ...DEFAULT_TEMPLATES, ...o.templates };
    const hooks = o.hooks ?? {};
    if (!o.pageNumbers && !o.templates?.footer) templates.footer = () => '';

    const executablePath = o.chromium ?? process.env.STORYBOOK_PDF_CHROMIUM;
    browser = await chromium.launch(executablePath ? { executablePath } : {});
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    context.setDefaultTimeout(o.timeout);

    const pdfOptions = {
      format: o.format,
      landscape: o.landscape,
      margin: o.margin,
      printBackground: true,
    };

    // ---- 1. Render every entry --------------------------------------------
    const rendered = new Array(entries.length);
    const failed = [];
    let done = 0;
    let next = 0;
    const worker = async () => {
      const page = await context.newPage();
      await page.addInitScript(listenForRender);
      try {
        while (next < entries.length) {
          const i = next++;
          const entry = entries[i];
          try {
            let pdf = await renderEntry(page, base, entry, css, pdfOptions, o, hooks);
            if (hooks.afterRender) pdf = (await hooks.afterRender({ entry, pdf })) ?? pdf;
            rendered[i] = pdf;
          } catch (err) {
            failed.push({ entry, error: err });
            log(`  ✗ ${label(entry)}: ${err.message.split('\n')[0]}`);
          }
          done++;
          log(`  [${done}/${entries.length}] ${label(entry)}`);
        }
      } finally {
        await page.close();
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(o.concurrency, entries.length)) }, worker));

    if (failed.length && o.strict) {
      throw new Error(`${failed.length} entr${failed.length === 1 ? 'y' : 'ies'} failed to render:\n` +
        failed.map((f) => `  - ${label(f.entry)}: ${f.error.message.split('\n')[0]}`).join('\n'));
    }

    const ok = entries.map((entry, i) => ({ entry, pdf: rendered[i] })).filter((r) => r.pdf);
    if (!ok.length) throw new Error('Nothing could be rendered.');

    // ---- 2. Load parts, render front & back matter ----------------------------
    const parts = [];
    for (const { entry, pdf } of ok) parts.push({ entry, doc: await PDFDocument.load(pdf) });

    const okEntries = parts.map((p) => p.entry);
    const tree = buildTree(okEntries);
    const date = o.date ?? new Date();
    const ctx = {
      title,
      subtitle: o.subtitle,
      author: o.author,
      version: o.version ?? (await guessVersion(o.source)),
      date,
      dateText: date.toLocaleDateString(theme.locale, { year: 'numeric', month: 'long', day: 'numeric' }),
      logo: theme.logo,
      theme,
      entries: okEntries,
      esc,
    };

    const page = await context.newPage();
    const html = async (template, extra) => {
      const body = await template({ ...ctx, ...extra });
      if (!body) return null;
      // The cover gets the whole sheet (full-bleed backgrounds); --pdf-margin-* tells it the regular margins.
      const options = extra.kind === 'cover' ? { ...pdfOptions, margin: { top: 0, right: 0, bottom: 0, left: 0 } } : pdfOptions;
      const doc = documentHtml(body, { printCss: css, theme, templateCss: templates.css, margin: o.margin, fullBleed: extra.kind === 'cover' });
      const bytes = await renderHtml(page, doc, options);
      return PDFDocument.load(bytes);
    };

    const front = [];
    const kinds = [];
    if (o.cover) {
      const doc = await html(templates.cover, { kind: 'cover' });
      if (doc) { front.push(doc); kinds.push(...doc.getPageIndices().map(() => 'cover')); }
    }
    if (o.toc) {
      // First pass with dummy numbers only to learn how many pages the TOC needs.
      const tocCtx = (numbers) => ({ kind: 'toc', tree: tocTree(tree, numbers), items: flatten(tocTree(tree, numbers)) });
      const dummy = await html(templates.toc, tocCtx(okEntries.map(() => 9999)));
      if (dummy) {
        const starts = startPages(parts, front.reduce((n, d) => n + d.getPageCount(), 0) + dummy.getPageCount());
        const doc = await html(templates.toc, tocCtx(starts));
        front.push(doc);
        kinds.push(...doc.getPageIndices().map(() => 'toc'));
      }
    }
    const back = templates.back ? await html(templates.back, { kind: 'back' }) : null;

    // ---- 3. Merge ---------------------------------------------------------------
    const out = await PDFDocument.create();
    const frontPageCount = front.reduce((n, d) => n + d.getPageCount(), 0);
    const starts = startPages(parts, frontPageCount);
    const sections = [];
    parts.forEach((p, i) => p.doc.getPageIndices().forEach(() => { kinds.push('content'); sections.push(okEntries[i]); }));
    if (back) kinds.push(...back.getPageIndices().map(() => 'back'));

    for (const doc of [...front, ...parts.map((p) => p.doc), ...(back ? [back] : [])]) {
      const pages = await out.copyPages(doc, doc.getPageIndices());
      pages.forEach((p) => out.addPage(p));
    }

    // ---- 4. Running header / footer ----------------------------------------
    const total = out.getPageCount();
    const running = await Promise.all(out.getPages().map(async (_, i) => {
      const entry = kinds[i] === 'content' ? sections[i - frontPageCount] : null;
      const pctx = { ...ctx, kind: kinds[i], pageNumber: i + 1, total, entry, section: entry ? entry.title.split('/').map((s) => s.trim()).join(' › ') : null };
      return `${(await templates.header(pctx)) ?? ''}${(await templates.footer(pctx)) ?? ''}`;
    }));
    if (running.some(Boolean)) {
      const { width, height } = out.getPage(0).getSize();
      await page.setContent(overlayHtml(running, { widthPt: width, heightPt: height, margin: o.margin, theme, templateCss: templates.css }), { waitUntil: 'load' });
      await settle(page, 0);
      const overlay = await page.pdf({ preferCSSPageSize: true, printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
      const used = running.map((r, i) => (r ? i : -1)).filter((i) => i >= 0);
      const embedded = await out.embedPdf(overlay, used);
      used.forEach((pageIndex, k) => {
        const target = out.getPage(pageIndex);
        const { width: w, height: h } = target.getSize();
        target.drawPage(embedded[k], { x: 0, y: 0, width: w, height: h });
      });
    }
    await page.close();

    // ---- 5. Links, bookmarks, metadata ---------------------------------------
    const idToPage = new Map();
    okEntries.forEach((e, i) => {
      idToPage.set(e.id, starts[i]);
      // `?path=/docs/button--docs` and `?path=/story/button--primary` both lead to the component.
      const component = e.id.split('--')[0];
      if (!idToPage.has(component)) idToPage.set(component, starts[i]);
    });

    rewriteLinks(out, { base, idToPage, storybookUrl: o.storybookUrl });
    addOutline(out, tree, starts);

    out.setTitle(title, { showInWindowTitleBar: true });
    if (o.subtitle) out.setSubject(o.subtitle);
    if (o.author) out.setAuthor(o.author);
    out.setCreator('storybook-pdf-export');
    out.setProducer('storybook-pdf-export (Playwright + pdf-lib)');
    out.setCreationDate(date);
    out.setModificationDate(date);

    if (hooks.beforeSave) await hooks.beforeSave({ doc: out, PDFLib, entries: okEntries, startPages: starts, context: ctx });

    const bytes = await out.save();
    if (o.output) {
      await mkdir(dirname(resolve(o.output)), { recursive: true });
      await writeFile(o.output, bytes);
    }

    return { bytes, pages: out.getPageCount(), entries: okEntries, failed };
  } finally {
    await browser?.close();
    await server?.close();
  }
}

// ---------------------------------------------------------------------------

async function loadIndex(base) {
  for (const file of ['index.json', 'stories.json']) {
    const res = await fetch(new URL(file, base)).catch(() => null);
    if (res?.ok) return normaliseIndex(await res.json());
  }
  throw new Error(`Could not load index.json from ${base}`);
}

async function guessTitle(source) {
  if (/^https?:/i.test(source)) return 'Storybook';
  // storybook-static usually lives next to the project's package.json.
  for (const dir of [resolve(source, '..'), resolve(source), process.cwd()]) {
    try {
      const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
      if (pkg.name) return pkg.name;
    } catch {}
  }
  return 'Storybook';
}

async function guessVersion(source) {
  if (/^https?:/i.test(source)) return undefined;
  for (const dir of [resolve(source, '..'), process.cwd()]) {
    try {
      const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
      if (pkg.version) return pkg.version;
    } catch {}
  }
  return undefined;
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

function label(entry) {
  return `${entry.title.replaceAll('/', ' › ')} › ${entry.name}`;
}

function startPages(parts, offset) {
  const starts = [];
  let page = offset;
  for (const p of parts) {
    starts.push(page);
    page += p.doc.getPageCount();
  }
  return starts;
}

/**
 * Runs in the page before Storybook boots: listens for the render events on
 * Storybook's channel. If no event arrives within a few seconds (very old or
 * customised setups) the DOM-based check takes over.
 */
function listenForRender() {
  const hook = (channel) => {
    for (const ev of ['docsRendered', 'storyRendered', 'storyErrored', 'storyThrewException']) {
      channel.on(ev, () => { window.__sbPdfRendered = true; });
    }
  };
  let current;
  Object.defineProperty(window, '__STORYBOOK_ADDONS_CHANNEL__', {
    configurable: true,
    get: () => current,
    set: (v) => { current = v; try { hook(v); } catch {} },
  });
  setTimeout(() => { window.__sbPdfWaitedForEvent = true; }, 5000);
}

async function renderEntry(page, base, entry, css, pdfOptions, o, hooks) {
  const viewMode = entry.type === 'docs' ? 'docs' : 'story';
  const url = new URL(`iframe.html?id=${encodeURIComponent(entry.id)}&viewMode=${viewMode}`, base);

  await page.goto(url.href, { waitUntil: 'load' });
  await page.addStyleTag({ content: css });

  // Wait for Storybook's own "rendered" event (falls back to the DOM for
  // older versions), or bail out on its error / no-preview screens.
  const state = await page.waitForFunction(
    (mode) => {
      const b = document.body.classList;
      if (b.contains('sb-show-errordisplay')) return 'error';
      if (b.contains('sb-show-nopreview')) return 'nopreview';
      if (window.__sbPdfRendered) return 'ok';
      if (b.contains('sb-show-preparing-story') || b.contains('sb-show-preparing-docs')) return false;
      if (window.__STORYBOOK_ADDONS_CHANNEL__ && !window.__sbPdfWaitedForEvent) return false;
      const root = document.querySelector(mode === 'docs' ? '#storybook-docs' : '#storybook-root, #root');
      return root && root.childElementCount > 0 ? 'ok' : false;
    },
    viewMode,
    { polling: 100 },
  ).then((h) => h.jsonValue());

  if (state === 'error') {
    const msg = await page.locator('#error-message, .sb-errordisplay_main').first().innerText().catch(() => 'Unknown error');
    throw new Error(`Storybook error: ${msg.trim()}`);
  }
  if (state === 'nopreview') throw new Error('No preview available');

  if (viewMode === 'story') {
    await page.evaluate((text) => {
      const h = document.createElement('div');
      h.className = 'sb-pdf-story-header';
      h.textContent = text;
      h.style.cssText = 'font:600 12pt/1.3 system-ui,sans-serif;margin:0 0 12pt;padding-bottom:6pt;border-bottom:1px solid #ccc;color:#222';
      document.body.prepend(h);
    }, label(entry));
  }

  await settle(page, o.delay);
  if (hooks.beforeRender) await hooks.beforeRender({ page, entry });
  return page.pdf(pdfOptions);
}

async function renderHtml(page, html, pdfOptions) {
  await page.setContent(html, { waitUntil: 'load' });
  await settle(page, 0);
  return page.pdf(pdfOptions);
}

/** Waits for network, fonts, images and animations to calm down. */
async function settle(page, delay) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(async () => {
    await document.fonts?.ready;
    await Promise.all(
      [...document.images].filter((img) => !img.complete).map((img) => new Promise((r) => { img.onload = img.onerror = r; })),
    );
    // Finish CSS animations / transitions so we don't print a half-faded state.
    for (const a of document.getAnimations?.() ?? []) {
      try { a.finish(); } catch {}
    }
    // Lazy parts (inline stories in docs, code snippets) keep mutating the DOM
    // for a moment after the render event — wait for 400 ms of silence.
    await new Promise((resolve) => {
      let timer;
      const done = () => { observer.disconnect(); clearTimeout(max); resolve(); };
      const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, 400); });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
      timer = setTimeout(done, 400);
      const max = setTimeout(done, 5000);
    });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  if (delay) await page.waitForTimeout(delay);
}

// ---- PDF post-processing --------------------------------------------------------

function goTo(doc, pageIndex) {
  const page = doc.getPage(Math.min(pageIndex, doc.getPageCount() - 1));
  return doc.context.obj([page.ref, PDFName.of('XYZ'), null, null, null]);
}

/**
 * Turns TOC marker links and links to other stories into internal jumps,
 * and repoints remaining links to the temporary server at the public Storybook.
 */
function rewriteLinks(doc, { base, idToPage, storybookUrl }) {
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const annot = annots.lookupMaybe(i, PDFDict);
      const action = annot?.lookupMaybe(PDFName.of('A'), PDFDict);
      const uriObj = action?.lookup(PDFName.of('URI'));
      if (!(uriObj instanceof PDFString || uriObj instanceof PDFHexString)) continue;
      const uri = uriObj.decodeText();

      let target = null;
      if (uri.startsWith(PAGE_LINK)) {
        target = Number(uri.slice(PAGE_LINK.length));
      } else if (uri.startsWith(base)) {
        const url = new URL(uri);
        const path = url.searchParams.get('path'); // /docs/<id> or /story/<id>
        const id = url.searchParams.get('id') ?? path?.split('/')[2];
        if (id) target = idToPage.get(id) ?? idToPage.get(id.split('--')[0]) ?? null;
        if (target == null && storybookUrl) {
          action.set(PDFName.of('URI'), PDFString.of(new URL(uri.slice(base.length), storybookUrl.replace(/\/?$/, '/')).href));
        }
      }

      if (target != null && Number.isFinite(target)) {
        annot.delete(PDFName.of('A'));
        annot.set(PDFName.of('Dest'), goTo(doc, target));
      }
    }
  }
}

/** Adds a nested bookmark tree (the sidebar of your Storybook) to the PDF. */
function addOutline(doc, tree, starts) {
  if (!tree.length) return;
  const ctx = doc.context;

  const build = (nodes, parentRef) => {
    const refs = nodes.map(() => ctx.nextRef());
    let total = 0;
    nodes.forEach((node, i) => {
      const dict = ctx.obj({
        Title: PDFHexString.fromText(node.label),
        Parent: parentRef,
        Dest: goTo(doc, starts[node.entry]),
      });
      if (i > 0) dict.set(PDFName.of('Prev'), refs[i - 1]);
      if (i < nodes.length - 1) dict.set(PDFName.of('Next'), refs[i + 1]);
      if (node.children.length) {
        const sub = build(node.children, refs[i]);
        dict.set(PDFName.of('First'), sub.first);
        dict.set(PDFName.of('Last'), sub.last);
        // Negative count = collapsed; keep only the top level expanded.
        dict.set(PDFName.of('Count'), ctx.obj(parentRef === outlineRef ? sub.count : -sub.count));
      }
      ctx.assign(refs[i], dict);
      total += 1;
      if (parentRef === outlineRef) total += node.children.length; // expanded top level
    });
    return { first: refs[0], last: refs.at(-1), count: total };
  };

  const outlineRef = ctx.nextRef();
  const top = build(tree, outlineRef);
  ctx.assign(outlineRef, ctx.obj({ Type: 'Outlines', First: top.first, Last: top.last, Count: top.count }));
  doc.catalog.set(PDFName.of('Outlines'), outlineRef);
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
}
