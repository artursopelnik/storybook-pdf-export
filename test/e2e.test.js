/**
 * End-to-end: runs the whole pipeline (server → Chromium → templates →
 * merge → links → bookmarks → hooks) against a tiny fake Storybook build.
 *
 * Needs Chromium: `npx playwright install chromium`, or point
 * STORYBOOK_PDF_CHROMIUM at a Chrome/Chromium binary. Without a browser the
 * suite is skipped locally and fails on CI.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFString, PDFHexString } from 'pdf-lib';
import { exportPdf } from '../src/index.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/fake-storybook', import.meta.url));
const chromium = process.env.STORYBOOK_PDF_CHROMIUM;

let browserMissing = null;
before(async () => {
  try {
    const { chromium: pw } = await import('playwright');
    const browser = await pw.launch(chromium ? { executablePath: chromium } : {});
    await browser.close();
  } catch (err) {
    browserMissing = err.message.split('\n')[0];
    if (process.env.CI) throw err;
  }
});

const run = (t, options = {}) => {
  if (browserMissing) return t.skip(`no browser: ${browserMissing}`);
  return exportPdf({ source: FIXTURE, output: null, chromium, concurrency: 2, timeout: 15_000, warn: () => {}, ...options });
};

/** Outline as indented strings: "Components", "  Button", … */
function outline(doc) {
  const titles = [];
  const walk = (ref, depth) => {
    for (let node = ref && doc.context.lookup(ref); node; node = node.get(PDFName.of('Next')) && doc.context.lookup(node.get(PDFName.of('Next')))) {
      titles.push(`${'  '.repeat(depth)}${node.lookup(PDFName.of('Title')).decodeText()}`);
      walk(node.get(PDFName.of('First')), depth + 1);
    }
  };
  const root = doc.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict);
  walk(root?.get(PDFName.of('First')), 0);
  return titles;
}

/** All link annotations: { page, dest } for internal and { page, uri } for external links. */
function links(doc) {
  const pages = doc.getPages();
  const result = [];
  pages.forEach((page, i) => {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    for (let k = 0; k < (annots?.size() ?? 0); k++) {
      const annot = annots.lookup(k, PDFDict);
      const dest = annot.lookupMaybe(PDFName.of('Dest'), PDFArray);
      const uri = annot.lookupMaybe(PDFName.of('A'), PDFDict)?.lookup(PDFName.of('URI'));
      if (dest) result.push({ page: i + 1, dest: pages.findIndex((p) => p.ref === dest.get(0)) + 1 });
      else if (uri instanceof PDFString || uri instanceof PDFHexString) result.push({ page: i + 1, uri: uri.decodeText() });
      else result.push({ page: i + 1, dead: true });
    }
  });
  return result;
}

test('exports docs pages and story-only components with TOC, bookmarks and links', async (t) => {
  const logs = [];
  const result = await run(t, { title: 'Fake DS', log: (m) => logs.push(m) });
  if (!result) return;

  // Intro, Button docs, Badge story; Broken fails, Secret is tagged no-pdf.
  assert.deepEqual(result.entries.map((e) => e.id), ['intro--docs', 'components-button--docs', 'components-badge--default']);
  assert.deepEqual(result.failed.map((f) => f.entry.id), ['components-broken--docs']);
  assert.match(result.failed[0].error.message, /Boom: component threw/);

  const doc = await PDFDocument.load(result.bytes);
  assert.equal(doc.getPageCount(), result.pages);
  assert.equal(doc.getTitle(), 'Fake DS');

  assert.deepEqual(outline(doc), ['Intro', 'Components', '  Button', '  Badge', '    Default']);

  const all = links(doc);
  // TOC (page 2) links to every bookmark target.
  const toc = all.filter((l) => l.page === 2).map((l) => l.dest);
  assert.ok(toc.length >= 5, `expected TOC links, got ${JSON.stringify(all)}`);
  assert.equal(toc[0], 3, 'Intro starts after cover + TOC');

  // Link from Intro to Button docs became an internal jump.
  const buttonPage = toc[2];
  assert.ok(all.some((l) => l.page >= 3 && l.page < buttonPage && l.dest === buttonPage), 'intro → button link');
  // Link to the excluded page points nowhere instead of a dead localhost URL.
  assert.ok(!all.some((l) => l.uri?.includes('127.0.0.1')), 'no links to the temporary server remain');
  assert.ok(all.some((l) => l.uri === 'https://example.com/'), 'external links are kept');
  assert.ok(logs.some((m) => /made non-clickable/.test(m)));
});

test('storybookUrl repoints links to stories outside the PDF', async (t) => {
  const result = await run(t, { storybookUrl: 'https://design.example.com/sb', cover: false, toc: false });
  if (!result) return;
  const doc = await PDFDocument.load(result.bytes);
  assert.ok(links(doc).some((l) => l.uri === 'https://design.example.com/sb/iframe.html?path=/docs/internal-secret--docs'));
});

test('strict mode fails on broken entries', async (t) => {
  if (browserMissing) return t.skip();
  await assert.rejects(run(t, { strict: true }), /1 entry failed to render:[\s\S]*Boom/);
});

test('templates, theme and hooks are applied', async (t) => {
  const calls = { header: [], filter: 0, before: [], after: [], save: 0 };
  const dir = await mkdtemp(join(tmpdir(), 'sb-pdf-e2e-'));
  try {
    const result = await run(t, {
      output: 'out/fake.pdf',
      cwd: dir,
      mode: 'docs',
      exclude: ['Components/Broken'],
      date: '2026-01-02',
      version: '9.9.9',
      theme: { accentColor: '#0b5fff', logo: join(FIXTURE, 'pixel.svg') },
      templates: {
        cover: (ctx) => `<h1>${ctx.esc(ctx.title)} ${ctx.version}</h1><img src="${ctx.logo}">`,
        header: (ctx) => {
          calls.header.push(`${ctx.kind}:${ctx.pageNumber}/${ctx.total}:${ctx.section ?? '-'}`);
          return ctx.kind === 'content' ? `<div class="running header">${ctx.esc(ctx.section)}</div>` : '';
        },
        back: () => '<p>Imprint</p>',
      },
      hooks: {
        filterEntries: (entries) => { calls.filter++; return [...entries].reverse(); },
        beforeRender: async ({ page, entry }) => { calls.before.push(entry.id); await page.evaluate(() => document.title); },
        afterRender: ({ entry, pdf }) => { calls.after.push(entry.id); return pdf; },
        beforeSave: ({ doc, PDFLib }) => { calls.save++; assert.ok(PDFLib.PDFDocument); doc.setKeywords(['e2e']); },
      },
    });
    if (!result) return;

    assert.equal(calls.filter, 1);
    // filterEntries reversed the order.
    assert.deepEqual(result.entries.map((e) => e.id), ['components-button--docs', 'intro--docs']);
    assert.deepEqual(calls.before.sort(), ['components-button--docs', 'intro--docs']);
    assert.deepEqual(calls.after.sort(), ['components-button--docs', 'intro--docs']);
    assert.equal(calls.save, 1);

    const kinds = calls.header.map((h) => h.split(':')[0]);
    assert.equal(kinds[0], 'cover');
    assert.equal(kinds[1], 'toc');
    assert.equal(kinds.at(-1), 'back');
    assert.ok(calls.header.includes(`content:3/${result.pages}:Components › Button`));

    const written = await PDFDocument.load(await readFile(join(dir, 'out/fake.pdf')));
    assert.equal(written.getPageCount(), result.pages);
    assert.equal(written.getKeywords(), 'e2e');
    assert.equal(written.getCreationDate().toISOString().slice(0, 10), '2026-01-02');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('--no-cover, --no-toc and stories mode', async (t) => {
  const result = await run(t, { cover: false, toc: false, pageNumbers: false, mode: 'stories' });
  if (!result) return;
  assert.deepEqual(result.entries.map((e) => e.id), ['components-button--primary', 'components-badge--default']);
  assert.equal(result.pages, 2);
});

test('template errors name the template', async (t) => {
  if (browserMissing) return t.skip();
  await assert.rejects(
    run(t, { templates: { cover: () => { throw new Error('nope'); } } }),
    /Template "cover" failed: nope/,
  );
});

test('option validation', async () => {
  await assert.rejects(exportPdf({}), /No Storybook source/);
  await assert.rejects(exportPdf({ source: FIXTURE, mode: 'everything' }), /Unknown mode/);
  await assert.rejects(exportPdf({ source: FIXTURE, concurrency: -1 }), /non-negative/);
  await assert.rejects(exportPdf({ source: FIXTURE, hooks: { beforeSave: 'x' } }), /must be a function/);
  await assert.rejects(exportPdf({ source: FIXTURE, date: 'not a date' }), /Invalid date/);
  await assert.rejects(exportPdf({ source: '/does/not/exist' }), /does not look like a Storybook build/);
});

test('settle() does not wait for lazy images below the fold', async (t) => {
  if (browserMissing) return t.skip();
  const { chromium: pw } = await import('playwright');
  const { settle } = await import('../src/render.js');
  const { serveStatic } = await import('../src/server.js');
  const server = await serveStatic(FIXTURE);
  const browser = await pw.launch(chromium ? { executablePath: chromium } : {});
  try {
    const page = await browser.newPage();
    await page.goto(new URL('index.html', server.url).href);
    await page.setContent(`<div style="height:5000px"></div><img loading="lazy" src="${server.url}pixel.svg">`);
    const started = Date.now();
    await settle(page);
    assert.ok(Date.now() - started < 3000, `settle took ${Date.now() - started} ms`);
    assert.equal(await page.evaluate(() => document.images[0].complete), true);
  } finally {
    await browser.close();
    await server.close();
  }
});
