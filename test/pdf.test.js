import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFDict, PDFString } from 'pdf-lib';
import { storyIdFromUrl, startPages, pageCount, pageIndexById, addOutline, merge, rewriteLinks } from '../src/pdf.js';
import { PAGE_LINK } from '../src/templates.js';

async function docWithPages(n) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) doc.addPage([200, 200]);
  return doc;
}

test('storyIdFromUrl understands all Storybook URL shapes', () => {
  assert.equal(storyIdFromUrl('http://x/?path=/docs/button--docs'), 'button--docs');
  assert.equal(storyIdFromUrl('http://x/iframe.html?path=/story/button--primary&args=a:b'), 'button--primary');
  assert.equal(storyIdFromUrl('http://x/iframe.html?id=button--primary&viewMode=story'), 'button--primary');
  assert.equal(storyIdFromUrl('http://x/?path=/settings/about'), null);
  assert.equal(storyIdFromUrl('http://x/assets/file.pdf'), null);
  assert.equal(storyIdFromUrl('not a url'), null);
});

test('startPages / pageCount', async () => {
  const docs = [await docWithPages(2), await docWithPages(3), await docWithPages(1)];
  assert.equal(pageCount(docs), 6);
  assert.deepEqual(startPages(docs), [0, 2, 5]);
  assert.deepEqual(startPages(docs, 4), [4, 6, 9]);
});

test('pageIndexById maps ids and their component prefix to the first page', () => {
  const map = pageIndexById(
    [{ id: 'button--docs' }, { id: 'button--primary' }, { id: 'badge--default' }],
    [3, 5, 7],
  );
  assert.equal(map.get('button--docs'), 3);
  assert.equal(map.get('button--primary'), 5);
  assert.equal(map.get('button'), 3);
  assert.equal(map.get('badge'), 7);
});

test('merge appends all pages', async () => {
  const out = await merge([await docWithPages(2), await docWithPages(1)]);
  assert.equal(out.getPageCount(), 3);
});

test('addOutline builds a valid nested bookmark tree', async () => {
  const doc = await docWithPages(4);
  const tree = [
    { label: 'Intro', entry: 0, children: [] },
    { label: 'Components', entry: 1, children: [
      { label: 'Button', entry: 1, children: [{ label: 'Primary', entry: 2, children: [] }] },
      { label: 'Badge', entry: 3, children: [] },
    ] },
  ];
  addOutline(doc, tree, [0, 1, 2, 3]);
  const root = doc.catalog.lookup(PDFName.of('Outlines'), PDFDict);
  // Visible: Intro, Components (open) + Button, Badge → 4
  assert.equal(root.get(PDFName.of('Count')).asNumber(), 4);
  const first = root.lookup(PDFName.of('First'), PDFDict);
  assert.equal(first.lookup(PDFName.of('Title')).decodeText(), 'Intro');
  const components = first.lookup(PDFName.of('Next'), PDFDict);
  assert.equal(components.get(PDFName.of('Count')).asNumber(), 2); // open
  const button = components.lookup(PDFName.of('First'), PDFDict);
  assert.equal(button.get(PDFName.of('Count')).asNumber(), -1); // closed
  assert.equal(doc.catalog.get(PDFName.of('PageMode')).asString(), '/UseOutlines');
  // Round-trips through save/load.
  await PDFDocument.load(await doc.save());
});

function docWithLinks(uris) {
  return (async () => {
    const doc = await docWithPages(3);
    const refs = uris.map((uri) =>
      doc.context.register(
        doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10], A: doc.context.obj({ S: 'URI', URI: PDFString.of(uri) }) }),
      ));
    doc.getPage(0).node.set(PDFName.of('Annots'), doc.context.obj(refs));
    return { doc, annot: (i) => doc.context.lookup(refs[i], PDFDict) };
  })();
}

const uriOf = (annot) => annot.lookup(PDFName.of('A'), PDFDict).lookup(PDFName.of('URI')).decodeText();

test('rewriteLinks: TOC markers, story links, dead links, external links', async () => {
  const base = 'http://127.0.0.1:1234/';
  const { doc, annot } = await docWithLinks([
    `${PAGE_LINK}2`,
    `${base}iframe.html?path=/docs/button--docs`,
    `${base}iframe.html?path=/docs/gone--docs`,
    'https://example.com/',
  ]);

  const stats = rewriteLinks(doc, { base, idToPage: new Map([['button--docs', 1]]) });
  assert.deepEqual(stats, { internal: 2, external: 0, removed: 1 });
  assert.ok(annot(0).get(PDFName.of('Dest')));
  assert.ok(annot(1).get(PDFName.of('Dest')));
  assert.equal(annot(2).get(PDFName.of('A')), undefined, 'dead localhost link made non-clickable');
  assert.equal(uriOf(annot(3)), 'https://example.com/');
});

test('rewriteLinks: storybookUrl keeps links to stories outside the PDF', async () => {
  const base = 'http://127.0.0.1:1234/';
  const { doc, annot } = await docWithLinks([`${base}iframe.html?path=/docs/gone--docs`]);
  const stats = rewriteLinks(doc, { base, idToPage: new Map(), storybookUrl: 'https://ds.example.com/storybook' });
  assert.deepEqual(stats, { internal: 0, external: 1, removed: 0 });
  assert.equal(uriOf(annot(0)), 'https://ds.example.com/storybook/iframe.html?path=/docs/gone--docs');
});
