/**
 * PDF post-processing with pdf-lib: merging, internal links, bookmarks and
 * the header / footer overlay.
 */
import { PDFDocument, PDFName, PDFString, PDFHexString, PDFDict, PDFArray } from 'pdf-lib';
import { PAGE_LINK } from './templates.js';

export const pageCount = (docs) => docs.reduce((n, d) => n + d.getPageCount(), 0);

/** Index of the first page of every part, given the number of pages before them. */
export function startPages(docs, offset = 0) {
  const starts = [];
  let page = offset;
  for (const doc of docs) {
    starts.push(page);
    page += doc.getPageCount();
  }
  return starts;
}

/** Appends all pages of `docs` to a new document. */
export async function merge(docs) {
  const out = await PDFDocument.create();
  for (const doc of docs) {
    const pages = await out.copyPages(doc, doc.getPageIndices());
    for (const p of pages) out.addPage(p);
  }
  return out;
}

/** Lays the pages of `overlayBytes` over the pages listed in `targets` (same order). */
export async function applyOverlay(doc, overlayBytes, targets) {
  if (!targets.length) return;
  const overlay = await PDFDocument.load(overlayBytes);
  if (overlay.getPageCount() < targets.at(-1) + 1) {
    throw new Error(`Header/footer overlay has ${overlay.getPageCount()} pages, expected ${targets.at(-1) + 1}.`);
  }
  const embedded = await doc.embedPdf(overlayBytes, targets);
  targets.forEach((pageIndex, k) => {
    const page = doc.getPage(pageIndex);
    const { width, height } = page.getSize();
    page.drawPage(embedded[k], { x: 0, y: 0, width, height });
  });
}

function goTo(doc, pageIndex) {
  const page = doc.getPage(Math.max(0, Math.min(pageIndex, doc.getPageCount() - 1)));
  return doc.context.obj([page.ref, PDFName.of('XYZ'), null, null, null]);
}

/** Story / docs id a Storybook URL points to: `?path=/docs/<id>`, `?path=/story/<id>` or `?id=<id>`. */
export function storyIdFromUrl(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const path = url.searchParams.get('path');
  return url.searchParams.get('id') ?? (path?.match(/^\/(?:docs|story)\/([^/?#]+)/)?.[1] ?? null);
}

/**
 * Rewrites the link annotations of the merged PDF:
 *   - TOC marker links            → jump to the page
 *   - links to other stories/docs → jump to their page, if they are in the PDF
 *   - other links to the temporary local server → `storybookUrl`, or made
 *     non-clickable (a link to 127.0.0.1:<random port> would be dead)
 * Returns statistics for logging.
 */
export function rewriteLinks(doc, { base, idToPage, storybookUrl }) {
  const stats = { internal: 0, external: 0, removed: 0 };
  const publicBase = storybookUrl ? storybookUrl.replace(/\/?$/, '/') : null;

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
        const id = storyIdFromUrl(uri);
        if (id) target = idToPage.get(id) ?? idToPage.get(id.split('--')[0]) ?? null;
        if (target == null) {
          if (publicBase) {
            action.set(PDFName.of('URI'), PDFString.of(new URL(uri.slice(base.length), publicBase).href));
            stats.external++;
          } else {
            annot.delete(PDFName.of('A'));
            stats.removed++;
          }
          continue;
        }
      }

      if (target != null && Number.isInteger(target)) {
        annot.delete(PDFName.of('A'));
        annot.set(PDFName.of('Dest'), goTo(doc, target));
        stats.internal++;
      }
    }
  }
  return stats;
}

/** Maps story ids (and their component prefix) to the page they start on. */
export function pageIndexById(entries, starts) {
  const map = new Map();
  entries.forEach((e, i) => {
    map.set(e.id, starts[i]);
    // `?path=/docs/button--docs` and `?path=/story/button--primary` both lead to the component.
    const component = e.id.split('--')[0];
    if (!map.has(component)) map.set(component, starts[i]);
  });
  return map;
}

/**
 * Adds a nested bookmark tree (the sidebar of your Storybook) to the PDF.
 * The top level is expanded, everything below collapsed.
 */
export function addOutline(doc, tree, starts) {
  if (!tree.length) return;
  const ctx = doc.context;
  const outlineRef = ctx.nextRef();

  // `open`: whether the nodes of this level show their children.
  const build = (nodes, parentRef, open) => {
    const refs = nodes.map(() => ctx.nextRef());
    let visible = 0;
    nodes.forEach((node, i) => {
      const dict = ctx.obj({
        Title: PDFHexString.fromText(node.label),
        Parent: parentRef,
        Dest: goTo(doc, starts[node.entry]),
      });
      if (i > 0) dict.set(PDFName.of('Prev'), refs[i - 1]);
      if (i < nodes.length - 1) dict.set(PDFName.of('Next'), refs[i + 1]);
      visible += 1;
      if (node.children.length) {
        const sub = build(node.children, refs[i], false);
        dict.set(PDFName.of('First'), sub.first);
        dict.set(PDFName.of('Last'), sub.last);
        // Count > 0: open, number of visible descendants. Count < 0: closed.
        dict.set(PDFName.of('Count'), ctx.obj(open ? sub.visible : -sub.visible));
        if (open) visible += sub.visible;
      }
      ctx.assign(refs[i], dict);
    });
    return { first: refs[0], last: refs.at(-1), visible };
  };

  const top = build(tree, outlineRef, true);
  ctx.assign(outlineRef, ctx.obj({ Type: 'Outlines', First: top.first, Last: top.last, Count: top.visible }));
  doc.catalog.set(PDFName.of('Outlines'), outlineRef);
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
}
