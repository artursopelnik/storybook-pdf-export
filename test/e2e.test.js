/**
 * End-to-end: runs the whole pipeline (server → Chromium → templates →
 * merge → links → bookmarks → hooks) against a tiny fake Storybook build.
 *
 * Needs a Chromium-based browser: Playwright's Chromium, Google Chrome or
 * Microsoft Edge (found automatically), or point
 * STORYBOOK_PDF_BROWSER_PATH at a binary. Without a browser the
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
import { launchBrowser } from '../src/browser.js';
import { pdfText } from './pdf-text.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/fake-storybook', import.meta.url));
const browserPath = process.env.STORYBOOK_PDF_BROWSER_PATH ?? process.env.STORYBOOK_PDF_CHROMIUM;
const openBrowser = async () => (await launchBrowser({ browserPath })).browser;

let browserMissing = null;
before(async () => {
  try {
    await (await openBrowser()).close();
  } catch (err) {
    browserMissing = err.message.split('\n')[0];
    if (process.env.CI) throw err;
  }
});

const run = (t, options = {}) => {
  if (browserMissing) return t.skip(`no browser: ${browserMissing}`);
  return exportPdf({ source: FIXTURE, output: null, browserPath, concurrency: 2, timeout: 15_000, warn: () => {}, ...options });
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

  // Intro, Button docs, Badge story, Tables, Tabs, Web Components; Broken fails, Secret is tagged no-pdf.
  assert.deepEqual(result.entries.map((e) => e.id), ['intro--docs', 'components-button--docs', 'components-badge--default', 'foundations-tables--docs', 'foundations-tabs--docs', 'foundations-web-components--docs']);
  assert.deepEqual(result.failed.map((f) => f.entry.id), ['components-broken--docs']);
  assert.match(result.failed[0].error.message, /Boom: component threw/);

  const doc = await PDFDocument.load(result.bytes);
  assert.equal(doc.getPageCount(), result.pages);
  assert.equal(doc.getTitle(), 'Fake DS');

  assert.deepEqual(outline(doc), ['Intro', 'Components', '  Button', '  Badge', '    Default', 'Foundations', '  Tables', '  Tabs', '  Web Components']);

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
      exclude: ['Components/Broken', 'Foundations'],
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
  await assert.rejects(exportPdf({ source: FIXTURE, port: 70000 }), /"port" must be/);
  await assert.rejects(exportPdf({ source: FIXTURE, port: 1.5 }), /"port" must be/);
  await assert.rejects(exportPdf({}), /No Storybook source/);
  await assert.rejects(exportPdf({ source: FIXTURE, mode: 'everything' }), /Unknown mode/);
  await assert.rejects(exportPdf({ source: FIXTURE, concurrency: -1 }), /non-negative/);
  await assert.rejects(exportPdf({ source: FIXTURE, hooks: { beforeSave: 'x' } }), /must be a function/);
  await assert.rejects(exportPdf({ source: FIXTURE, date: 'not a date' }), /Invalid date/);
  await assert.rejects(exportPdf({ source: '/does/not/exist' }), /does not look like a Storybook build/);
});

test('settle() does not wait for lazy images below the fold', async (t) => {
  if (browserMissing) return t.skip();
  const { settle } = await import('../src/render.js');
  const { serveStatic } = await import('../src/server.js');
  const server = await serveStatic(FIXTURE);
  const browser = await openBrowser();
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

test('scroll containers are expanded and wide tables fit the page', async (t) => {
  const seen = {};
  const result = await run(t, {
    include: ['Foundations'],
    cover: false,
    toc: false,
    hooks: {
      beforeRender: async ({ page }) => {
        Object.assign(seen, await page.evaluate(() => {
          const box = (id) => document.getElementById(id);
          return {
            pageWidth: document.documentElement.clientWidth,
            wideRight: box('wide').getBoundingClientRect().right,
            yExpanded: box('scroll-y').clientHeight >= box('scroll-y').scrollHeight,
            optOutUntouched: box('opt-out').clientHeight < box('opt-out').scrollHeight,
          };
        }));
      },
    },
  });
  if (!result) return;
  assert.ok(seen.wideRight <= seen.pageWidth + 1, `wide table fits: right edge ${seen.wideRight} > ${seen.pageWidth}`);
  assert.equal(seen.pageWidth, 672, 'laid out at the printable width of A4 minus margins');
  assert.ok(seen.yExpanded, 'vertical scroll box shows all rows');
  assert.ok(seen.optOutUntouched, '.sb-print-no-fit is left alone');
});

/** Collects what the page looks like right before printing (shadow DOM included). */
const inspectTabsPage = async (page) =>
  page.evaluate(() => {
    const docs = document.getElementById('storybook-docs');
    const shown = (el) => el.getClientRects().length > 0;
    // Visible text in the flat tree: shadow roots and slotted children, one line per text node.
    const lines = [];
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.data.trim() && shown(node.parentElement)) lines.push(node.data.trim());
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE || ['STYLE', 'SCRIPT'].includes(node.tagName)) return;
      if (node.localName === 'slot') return node.assignedNodes({ flatten: true }).forEach(walk);
      if (!shown(node)) return;
      (node.shadowRoot ? node.shadowRoot.childNodes : node.childNodes).forEach(walk);
    };
    walk(docs);
    const shadow = (id) => docs.querySelector(`#${id}`).shadowRoot;
    const iconStyle = (el) => {
      const cs = getComputedStyle(el);
      return { maskImage: cs.maskImage, backgroundImage: decodeURIComponent(cs.backgroundImage) };
    };
    return {
      text: lines.join('\n'),
      tablistsShown: [
        ...docs.querySelectorAll('#react-tabs [role="tablist"], #hidden-tabs [role="tablist"]'),
        shadow('shadow-tabs').querySelector('[role="tablist"]'),
        shadow('slotted-tabs').querySelector('[role="tablist"]'),
      ].map(shown),
      keptTablistShown: shown(docs.querySelector('#kept-tabs [role="tablist"]')),
      ...iconStyle(document.getElementById('mask-icon')),
      shadowIcon: iconStyle(shadow('shadow-tabs').getElementById('shadow-icon')),
    };
  });

const count = (text, needle) => text.split(needle).length - 1;

test('tabs are expanded: every tab is printed under its label', async (t) => {
  let seen;
  const result = await run(t, {
    include: ['Foundations/Tabs'],
    cover: false,
    toc: false,
    hooks: { beforeRender: async ({ page }) => { seen = await inspectTabsPage(page); } },
  });
  if (!result) return;
  assert.equal(result.failed.length, 0);

  // React-style tabs (inactive content not in the DOM) and hidden panels.
  // Web components: tabs and panels in the shadow DOM, or panels slotted in.
  const contents = ['Content of Overview', 'Content of Usage', 'Do content', 'Dont content',
    'Shadow Alpha content', 'Shadow Beta content', 'Shadow Gamma content', 'Slotted One content', 'Slotted Two content'];
  for (const content of contents) {
    assert.equal(count(seen.text, content), 1, `"${content}" printed once:\n${seen.text}`);
  }
  for (const label of ['Overview', 'Usage', 'Do', "Don't", 'Alpha', 'Beta', 'Gamma', 'One', 'Two']) {
    assert.equal(seen.text.split('\n').filter((l) => l === label).length, 1, `label ${label} once:\n${seen.text}`);
  }
  assert.ok(!seen.text.includes('Content of Disabled'), 'disabled tabs are skipped');
  assert.deepEqual(seen.tablistsShown, [false, false, false, false], 'tab bars are hidden');

  // Opted out with .sb-print-no-fit: left as it is.
  assert.ok(seen.keptTablistShown);
  assert.ok(seen.text.includes('Kept A content') && !seen.text.includes('Kept B content'));
});

test('expandTabs: false prints only the active tab', async (t) => {
  let seen;
  const result = await run(t, {
    include: ['Foundations/Tabs'],
    cover: false,
    toc: false,
    expandTabs: false,
    hooks: { beforeRender: async ({ page }) => { seen = await inspectTabsPage(page); } },
  });
  if (!result) return;
  assert.ok(seen.text.includes('Content of Overview'));
  assert.ok(!seen.text.includes('Content of Usage'));
  assert.ok(!seen.text.includes('Shadow Beta content'));
  assert.deepEqual(seen.tablistsShown, [true, true, true, true]);
});

/** Asserts that every line appears exactly once in the PDF text, in the given order. */
const assertInOrder = (text, expected) => {
  const lines = text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  let at = -1;
  for (const line of expected) {
    assert.equal(lines.filter((l) => l === line).length, 1, `"${line}" appears once in the PDF:\n${text}`);
    const i = lines.indexOf(line);
    assert.ok(i > at, `"${line}" comes after the previous one:\n${text}`);
    at = i;
  }
};

test('PDF: light-DOM, shadow-DOM and slotted tabs, every enabled panel once in tab order', async (t) => {
  const warnings = [];
  const result = await run(t, { include: ['Foundations/Tabs'], cover: false, toc: false, warn: (m) => warnings.push(m) });
  if (!result) return;
  const text = (await pdfText(result.bytes)).join('\n');
  assertInOrder(text, [
    'Overview', 'Content of Overview', 'Usage', 'Content of Usage',
    'Do', 'Do content', "Don't", 'Dont content',
    'Kept A content',
    'Alpha', 'Shadow Alpha content', 'Beta', 'Shadow Beta content', 'Gamma', 'Shadow Gamma content',
    'Slotted One content', 'Slotted Two content',
  ]);
  assert.ok(!text.includes('Content of Disabled'), 'disabled tab skipped');
  assert.ok(!text.includes('Kept B content'), 'opted-out tab set keeps only its active tab');
  assert.deepEqual(warnings, []);
});

test('PDF: Stencil-like web components (late hydration, panels in shadow roots, nested and lazy tab sets)', async (t) => {
  const warnings = [];
  const result = await run(t, { include: ['Foundations/Web Components'], cover: false, toc: false, warn: (m) => warnings.push(m) });
  if (!result) return;
  assert.equal(result.failed.length, 0);
  const text = (await pdfText(result.bytes)).join('\n');
  assertInOrder(text, [
    // Outer tab set: panels revealed in place, nested tab set expanded inside "Usage".
    'Install', 'Outer install text',
    'Usage', 'Outer usage text', 'React', 'Inner react text', 'Vue', 'Inner vue text',
    'API', 'Outer api text',
    // Only the active panel is rendered: clicked through, shadow and slot content copied.
    'Colors', 'Lazy Colors card', 'Colors slotted note',
    'Spacing', 'Lazy Spacing card', 'Spacing slotted note',
    'Motion', 'Lazy Motion card', 'Motion slotted note',
    // Opted out: tab bar and active tab only.
    'Kept One', 'Kept Two', 'Kept wc one text',
  ]);
  assert.ok(!/Legacy|legacy/.test(text), 'disabled tab and its panel are left out');
  assert.ok(!text.includes('Kept wc two text'));
  assert.deepEqual(warnings, []);
});

test('expandTabs reports tab sets it cannot expand instead of printing empty panels', async (t) => {
  if (browserMissing) return t.skip();
  const { expandTabs } = await import('../src/prepare.js');
  const browser = await openBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <div id="dead">
        <div role="tablist">
          <button role="tab" aria-selected="true" aria-controls="dead-panel">First</button>
          <button role="tab" aria-selected="false" aria-controls="dead-panel">Second</button>
        </div>
        <div role="tabpanel" id="dead-panel"><p>First content</p></div>
      </div>
      <div id="blank">
        <div role="tablist">
          <button role="tab" aria-selected="true" aria-controls="blank-panel">One</button>
          <button role="tab" aria-selected="false" aria-controls="blank-panel">Two</button>
          <button role="tab" aria-selected="false" aria-controls="blank-panel">Three</button>
        </div>
        <div role="tabpanel" id="blank-panel"><p>One content</p></div>
      </div>
      <script>
        // "Two" renders an empty panel; "Second" ignores clicks.
        document.querySelector('#blank').addEventListener('click', (e) => {
          const tab = e.target.closest('[role="tab"]');
          for (const t of document.querySelectorAll('#blank [role="tab"]')) t.setAttribute('aria-selected', String(t === tab));
          document.getElementById('blank-panel').innerHTML = tab.textContent === 'Two' ? '<p> </p>' : '<p>' + tab.textContent + ' content</p>';
        });
      </script>`);
    const stats = await page.evaluate(expandTabs);
    assert.equal(stats.tabsets, 1);
    assert.equal(stats.tabs, 2);
    assert.match(stats.skipped.join('\n'), /"First, Second": no content for "Second"/);
    assert.match(stats.skipped.join('\n'), /"First, Second": could not be expanded/);
    assert.match(stats.skipped.join('\n'), /"One, Two, Three": no content for "Two"/);
    const seen = await page.evaluate(() => ({
      dead: document.querySelector('#dead [role="tablist"]').getClientRects().length > 0,
      blank: document.querySelector('#blank .sb-pdf-tabs').innerText,
    }));
    assert.ok(seen.dead, 'tab set that could not be expanded is left as it is');
    assert.match(seen.blank, /One\s+One content\s+Three\s+Three content/);
  } finally {
    await browser.close();
  }
});

test('CSS mask icons are printed as colored vector backgrounds (no hairline edges)', async (t) => {
  let seen;
  const result = await run(t, {
    include: ['Foundations/Tabs'],
    cover: false,
    toc: false,
    hooks: { beforeRender: async ({ page }) => { seen = await inspectTabsPage(page); } },
  });
  if (!result) return;
  assert.equal(seen.maskImage, 'none');
  assert.match(seen.backgroundImage, /^url\("data:image\/svg\+xml/);
  assert.match(seen.backgroundImage, /fill="rgb\(200, 0, 0\)"/, 'recolored with the background color');
  assert.ok(!seen.backgroundImage.includes('currentColor'));
  assert.equal(seen.shadowIcon.maskImage, 'none', 'icons in shadow roots too');
  assert.match(seen.shadowIcon.backgroundImage, /fill="rgb\(0, 0, 200\)"/);
});

test('a cover template that overflows is cut to one page', async (t) => {
  const warnings = [];
  const result = await run(t, {
    include: ['Intro'],
    toc: false,
    templates: { cover: () => '<p>line</p>'.repeat(300) },
    warn: (m) => warnings.push(m),
  });
  if (!result) return;
  const withoutCover = await run(t, { include: ['Intro'], toc: false, cover: false });
  assert.equal(result.pages, withoutCover.pages + 1);
  assert.match(warnings.join(), /cover template produced \d+ pages/);
});

test('fitForPrint is fully reversible and the addon script yields to the exporter', async (t) => {
  if (browserMissing) return t.skip();
  const { fitForPrint, fitOnPrintScript } = await import('../src/fit.js');
  const { serveStatic } = await import('../src/server.js');
  const server = await serveStatic(FIXTURE);
  const browser = await openBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 672, height: 900 } });
    await page.goto(new URL('iframe.html?id=foundations-tables--docs&viewMode=docs', server.url).href);
    await page.waitForSelector('#wide');
    const snapshot = () => page.evaluate(() => document.getElementById('storybook-docs').innerHTML);
    const before = await snapshot();

    const stats = await page.evaluate(fitForPrint, { width: 672 });
    assert.equal(stats.expanded, 1);
    assert.equal(stats.opened, 1);
    assert.equal(stats.forced, 0, `fits without breaking words anywhere: ${JSON.stringify(stats)}`);
    assert.ok(await page.evaluate(() => document.querySelector('#wide td').textContent.includes('​')), 'break opportunities after separators');

    await page.evaluate(fitForPrint, { restore: true });
    assert.equal(await snapshot(), before, 'DOM restored exactly');

    // The addon's print script fits on beforeprint, but not during an export.
    await page.addScriptTag({ content: fitOnPrintScript() });
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    assert.notEqual(await snapshot(), before);
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    assert.equal(await snapshot(), before);
    await page.evaluate(() => { window.__STORYBOOK_PDF_EXPORT__ = true; window.dispatchEvent(new Event('beforeprint')); });
    assert.equal(await snapshot(), before, 'yields to the exporter');
  } finally {
    await browser.close();
    await server.close();
  }
});
