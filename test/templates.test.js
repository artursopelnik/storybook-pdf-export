import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cover, toc, footer, esc, resolveLogo, documentHtml, overlayHtml, DEFAULT_THEME, PAGE_LINK } from '../src/templates.js';

const ctx = { title: 'ACME <DS>', subtitle: 'Docs', version: '1.2.0', dateText: '4 November 2026', esc };

test('esc escapes HTML', () => {
  assert.equal(esc(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
});

test('cover renders escaped title, subtitle and meta line', () => {
  const html = cover(ctx);
  assert.match(html, /ACME &lt;DS&gt;/);
  assert.match(html, /Version 1\.2\.0 · 4 November 2026/);
  assert.doesNotMatch(html, /<img/);
  assert.match(cover({ ...ctx, logo: 'data:image/png;base64,AA' }), /<img class="logo"/);
});

test('toc links point at the page marker', () => {
  const tree = [{ label: 'Components', depth: 0, page: 3, href: `${PAGE_LINK}2`, children: [{ label: 'Button', depth: 1, page: 4, href: `${PAGE_LINK}3`, children: [] }] }];
  const html = toc({ ...ctx, tree });
  assert.match(html, new RegExp(`href="${PAGE_LINK}3"`));
  assert.match(html, /class="d1"/);
});

test('default footer skips the cover and shows the section', () => {
  assert.equal(footer({ ...ctx, kind: 'cover', pageNumber: 1, total: 5 }), '');
  const html = footer({ ...ctx, kind: 'content', pageNumber: 3, total: 5, section: 'Components › Button' });
  assert.match(html, /3 \/ 5/);
  assert.match(html, /Components › Button/);
});

test('resolveLogo inlines local files and passes URLs through', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sb-pdf-logo-'));
  try {
    await writeFile(join(dir, 'logo.svg'), '<svg/>');
    assert.equal(await resolveLogo('logo.svg', dir), `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`);
    assert.equal(await resolveLogo('https://x.test/l.png'), 'https://x.test/l.png');
    assert.equal(await resolveLogo(null), null);
    await writeFile(join(dir, 'logo.bmp'), '');
    await assert.rejects(resolveLogo('logo.bmp', dir), /Unsupported logo format/);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('documentHtml / overlayHtml wire theme variables and page geometry', () => {
  const margin = { top: '1mm', right: '2mm', bottom: '3mm', left: '4mm' };
  const doc = documentHtml('<p>x</p>', { theme: { ...DEFAULT_THEME, accentColor: '#123456' }, margin, fullBleed: true });
  assert.match(doc, /--pdf-accent: #123456/);
  assert.match(doc, /--pdf-margin-left: 4mm/);
  assert.match(doc, /@page \{ margin: 0; \}/);
  const overlay = overlayHtml(['<b>a</b>', ''], { widthPt: 595, heightPt: 842, margin, theme: DEFAULT_THEME });
  assert.equal(overlay.match(/class="sheet"/g).length, 2);
  assert.match(overlay, /size: 595pt 842pt/);
});

test('the public templates export holds only the documented defaults', async () => {
  const { templates } = await import('../src/index.js');
  assert.deepEqual(Object.keys(templates).sort(), ['BASE_CSS', 'DEFAULT_THEME', 'back', 'cover', 'css', 'footer', 'header', 'toc']);
  assert.ok(Object.isFrozen(templates));
});
