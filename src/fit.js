/**
 * Makes scroll containers and wide tables printable. Paper can't scroll, so
 * content inside `overflow: auto | scroll` boxes would be cut off.
 *
 *   - vertical scroll boxes (max-height + overflow-y) are expanded fully
 *   - horizontal scroll boxes are opened up
 *   - whatever is then wider than the page (those boxes, wide tables) is made
 *     to fit, gentlest step first, stopping as soon as it fits:
 *       1. let table cells wrap at spaces          (`white-space: normal`)
 *       2. also allow breaks after . / - _ : in cells (tokens, paths, CSS vars)
 *       3. scale only this element down             (never below `minScale`)
 *       4. break cell content anywhere              (last resort)
 *     Nothing is cut off; the rest of the page keeps its size.
 *
 * Opt out per element with the class `sb-print-no-fit`.
 * `fitForPrint({ restore: true })` undoes everything (used after printing).
 *
 * The function is self-contained on purpose: it is serialised and runs in the
 * browser, both in the PDF export and in the addon's print button.
 */
export function fitForPrint({ width, minScale = 0.65, restore = false } = {}) {
  const ATTR = 'data-sb-print-fit';
  const ZWSP = '​';

  // ---- Undo a previous run (the print button can be used more than once) ----
  for (const el of document.querySelectorAll(`[${ATTR}]`)) {
    const style = el.getAttribute(ATTR);
    if (style) el.setAttribute('style', style);
    else el.removeAttribute('style');
    el.removeAttribute(ATTR);
  }
  for (const [node, text] of window.__sbPrintFitText ?? []) node.data = text;
  window.__sbPrintFitText = [];
  if (restore) return null;

  const root = document.querySelector('#storybook-docs') ?? document.body;

  // Right edge everything has to stay within: the content box of the docs
  // root, but never wider than the printable width we were given.
  const measure = (parent, css) => {
    const probe = document.createElement('div');
    probe.style.cssText = `visibility:hidden;height:0;${css}`;
    parent.appendChild(probe);
    const box = probe.getBoundingClientRect();
    probe.remove();
    return box;
  };
  const box = measure(root, 'width:100%');
  const max = typeof width === 'number' ? width : measure(document.body, `position:absolute;width:${width ?? '100%'}`).width;
  const limit = Math.min(box.right, box.left + max);

  const remember = (el) => {
    if (!el.hasAttribute(ATTR)) el.setAttribute(ATTR, el.getAttribute('style') ?? '');
  };
  const set = (el, prop, value) => {
    remember(el);
    el.style.setProperty(prop, value, 'important');
  };
  const scrolls = (value) => value === 'auto' || value === 'scroll';
  const skip = (el) => el.closest('.sb-print-no-fit, pre, .docblock-source');

  const stats = { expanded: 0, opened: 0, wrapped: 0, breaks: 0, scaled: 0, forced: 0 };
  const candidates = [...root.querySelectorAll('*')].filter((el) => !skip(el));

  // ---- 1. Expand vertical scroll boxes (changes heights, not widths) --------
  for (const el of candidates) {
    if (scrolls(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1) {
      set(el, 'max-height', 'none');
      set(el, 'height', 'auto');
      set(el, 'overflow-y', 'visible');
      stats.expanded++;
    }
  }

  // ---- 2. Make whatever is wider than the page fit ---------------------------
  // Width the element needs in its own (unzoomed) CSS px: a table its own
  // width, a scroll container the width of its overflowing content.
  const zoomOf = (el) => Number(el.style.zoom) || 1;
  const needed = (el) =>
    el.matches('table') ? el.getBoundingClientRect().width / zoomOf(el) : el.scrollWidth + (el.offsetWidth - el.clientWidth);
  const room = (el) => limit - el.getBoundingClientRect().left;
  const tooWide = (el) => needed(el) * zoomOf(el) > room(el) + 1.5;
  const cellsOf = (el) => [...el.querySelectorAll(el.matches('table') ? 'th, td' : 'table th, table td')];
  const tablesOf = (el) => (el.matches('table') ? [el] : [...el.querySelectorAll('table')]);

  const steps = {
    wrapped(el) {
      for (const cell of cellsOf(el)) set(cell, 'white-space', 'normal');
    },
    breaks(el) {
      for (const cell of cellsOf(el)) {
        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          // Break after separators, but keep numbers like 1.0.0 or 0.5 together.
          const text = node.data.replace(/(?<=[^\s./_:-])([./_:-])(?=[^\s./_:\d-])/g, `$1${ZWSP}`);
          if (text !== node.data) {
            window.__sbPrintFitText.push([node, node.data]);
            node.data = text;
          }
        }
      }
    },
    scaled(el) {
      // Zooming re-lays the content out at a new width, so converge in a few steps.
      let zoom = 1;
      for (let i = 0; i < 4 && tooWide(el) && zoom > minScale; i++) {
        zoom = Math.max(minScale, Math.min(zoom, (room(el) - 1) / needed(el)) * (i ? 0.99 : 1));
        set(el, 'zoom', String(zoom));
      }
    },
    forced(el) {
      for (const table of tablesOf(el)) set(table, 'width', '100%');
      for (const cell of cellsOf(el)) set(cell, 'overflow-wrap', 'anywhere');
    },
  };

  const handled = new Set();
  const fit = (el) => {
    if ([...handled].some((h) => h.contains(el)) || !tooWide(el)) return;
    handled.add(el);
    for (const [name, step] of Object.entries(steps)) {
      step(el);
      if (!tooWide(el)) return void stats[name]++;
    }
    stats.forced++;
  };

  for (const el of candidates) {
    if (scrolls(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1) {
      set(el, 'overflow-x', 'visible');
      stats.opened++;
      fit(el);
    }
  }
  for (const table of root.querySelectorAll('table')) {
    if (!skip(table)) fit(table);
  }

  return stats;
}

/** Browser-side wiring for the addon: fit before printing, restore afterwards. */
export const fitOnPrintScript = () => `
(() => {
  const fitForPrint = ${fitForPrint.toString()};
  // During a PDF export the exporter fits the page itself (page.pdf() fires
  // beforeprint too), so stay out of its way.
  const exporting = () => window.__STORYBOOK_PDF_EXPORT__ === true;
  // A4 portrait minus the default margins: what the print dialog gives us.
  window.addEventListener('beforeprint', () => exporting() || fitForPrint({ width: '178mm' }));
  window.addEventListener('afterprint', () => exporting() || fitForPrint({ restore: true }));
})();`;
