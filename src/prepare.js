/**
 * Page preparations that run in the browser right before printing. Both
 * functions are self-contained on purpose: they are serialised and evaluated
 * in the page.
 *
 * Opt out per element with the class `sb-print-no-fit`.
 */

/**
 * Paper can't click: print every tab of a tab set instead of only the active
 * one. Each tab is clicked in turn (so tabs that only render the active panel,
 * as most React tab components do, work too), its panel is copied, and the
 * copies are shown one after another, each under its tab label. The tab bar
 * and the live panels are hidden.
 *
 * Finds tab sets by their ARIA roles: `role="tablist"`, `role="tab"`,
 * `role="tabpanel"` (with `aria-controls` on the tabs, or a panel next to
 * the tab list).
 *
 * @returns {Promise<{ tabsets: number, tabs: number }>}
 */
export async function expandTabs({ quietMs = 150, maxMs = 3000 } = {}) {
  const stats = { tabsets: 0, tabs: 0 };
  const shown = (el) => el.getClientRects().length > 0;
  const hide = (el) => el.style.setProperty('display', 'none', 'important');

  // Waits until the DOM has stopped changing after a click (bounded).
  const quiet = () =>
    new Promise((resolve) => {
      let timer;
      const done = () => {
        observer.disconnect();
        clearTimeout(timer);
        clearTimeout(cap);
        resolve();
      };
      const observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(done, quietMs);
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
      timer = setTimeout(done, quietMs);
      const cap = setTimeout(done, maxMs);
    });

  // Copy of a panel without duplicate ids; canvases keep their pixels.
  const copy = (panel) => {
    const clone = panel.cloneNode(true);
    const from = panel.querySelectorAll('canvas');
    clone.querySelectorAll('canvas').forEach((canvas, i) => {
      try {
        canvas.getContext('2d')?.drawImage(from[i], 0, 0);
      } catch {}
    });
    clone.removeAttribute('hidden');
    clone.removeAttribute('role');
    for (const el of [clone, ...clone.querySelectorAll('[id]')]) el.removeAttribute('id');
    return clone;
  };

  const lists = [...document.querySelectorAll('[role="tablist"]')].filter(
    (list) => shown(list) && !list.closest('.sb-print-no-fit, .sb-pdf-tabs'),
  );

  for (const list of lists) {
    const tabs = [...list.querySelectorAll('[role="tab"]')].filter(
      (tab) => tab.closest('[role="tablist"]') === list && !tab.disabled && tab.getAttribute('aria-disabled') !== 'true',
    );
    // A tab that is a real link would navigate away: leave such tab sets alone.
    const navigates = tabs.some((tab) => tab.matches('a[href]') && !tab.getAttribute('href').startsWith('#'));
    if (tabs.length < 2 || navigates) continue;

    // The panel a tab shows: via aria-controls, else the visible panel next to the list.
    const panelOf = (tab) => {
      const id = tab.getAttribute('aria-controls');
      const byId = id && document.getElementById(id);
      if (byId) return byId;
      for (let scope = list.parentElement; scope; scope = scope.parentElement) {
        const panel = [...scope.querySelectorAll('[role="tabpanel"]')].find((p) => shown(p) && !p.closest('.sb-pdf-tabs'));
        if (panel) return panel;
      }
      return null;
    };

    const sections = [];
    const panels = new Set();
    for (const tab of tabs) {
      if (tab.getAttribute('aria-selected') !== 'true') {
        tab.click();
        await quiet();
      }
      const panel = panelOf(tab);
      if (!panel) continue;
      panels.add(panel);
      const label = (tab.innerText || tab.getAttribute('aria-label') || tab.title || '').trim() || `Tab ${sections.length + 1}`;
      sections.push({ label, content: copy(panel) });
    }
    if (sections.length < 2) continue;

    const container = document.createElement('div');
    container.className = 'sb-pdf-tabs';
    for (const { label, content } of sections) {
      const section = document.createElement('div');
      section.className = 'sb-pdf-tab';
      const heading = document.createElement('div');
      heading.className = 'sb-pdf-tab-label';
      heading.textContent = label;
      section.append(heading, content);
      container.append(section);
    }
    const first = [...panels][0];
    first.parentNode.insertBefore(container, first);
    hide(list);
    for (const panel of panels) hide(panel);
    // Panels that belong to this tab set but weren't reached (e.g. disabled tabs).
    for (const tab of list.querySelectorAll('[role="tab"]')) {
      const other = tab.getAttribute('aria-controls') && document.getElementById(tab.getAttribute('aria-controls'));
      if (other && !container.contains(other)) hide(other);
    }
    stats.tabsets++;
    stats.tabs += sections.length;
  }
  return stats;
}

/**
 * Chromium prints elements with a CSS `mask-image` as an image with a soft
 * mask, which shows thin hairlines along the element's edges in the PDF. The
 * common icon technique (an element with `background-color` and an SVG as
 * mask) is therefore turned into what it looks like: the SVG, filled with the
 * background color, as a vector `background-image`.
 *
 * Only single-color SVG masks are converted; anything else is left alone.
 *
 * @returns {Promise<number>} number of converted elements
 */
export async function vectorizeMasks() {
  const TRANSPARENT = /^(transparent|rgba\(0, 0, 0, 0\))$/;
  const COMPLEX = 'parsererror, linearGradient, radialGradient, pattern, image, mask, filter, style, foreignObject';

  const svgText = async (url) => {
    const data = url.match(/^data:([^,]*),(.*)$/s);
    if (data) {
      if (!/svg/i.test(data[1])) return null;
      if (!/;base64/i.test(data[1])) return decodeURIComponent(data[2]);
      const bytes = Uint8Array.from(atob(data[2]), (c) => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }
    try {
      const text = await (await fetch(url)).text();
      return /<svg[\s>]/.test(text) ? text : null;
    } catch {
      return null;
    }
  };

  const recolor = (text, color) => {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const svg = doc.documentElement;
    if (svg.nodeName !== 'svg' || doc.querySelector(COMPLEX)) return null;
    // Unset fills default to the root's fill; explicit fills/strokes (also
    // currentColor) become the color, `none` stays none.
    if (!svg.hasAttribute('fill')) svg.setAttribute('fill', color);
    svg.setAttribute('color', color);
    for (const el of [svg, ...svg.querySelectorAll('*')]) {
      for (const prop of ['fill', 'stroke']) {
        const attr = el.getAttribute(prop);
        if (attr && !/^none$/i.test(attr)) el.setAttribute(prop, color);
        const inline = el.style?.getPropertyValue(prop);
        if (inline && !/^none$/i.test(inline)) el.style.setProperty(prop, color);
      }
    }
    return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}")`;
  };

  const cache = new Map();
  let converted = 0;
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.sb-print-no-fit')) continue;
    const cs = getComputedStyle(el);
    const mask = cs.maskImage && cs.maskImage !== 'none' ? cs.maskImage : cs.webkitMaskImage;
    if (!mask || mask === 'none') continue;
    const url = mask.match(/^url\("?(.*?)"?\)$/s)?.[1]; // one mask layer only
    const color = cs.backgroundColor;
    if (!url || cs.backgroundImage !== 'none' || TRANSPARENT.test(color)) continue;

    const key = `${color}|${url}`;
    if (!cache.has(key)) {
      const text = await svgText(url);
      cache.set(key, text && recolor(text, color));
    }
    const image = cache.get(key);
    if (!image) continue;

    const set = (prop, value) => value && el.style.setProperty(prop, value, 'important');
    set('background-image', image);
    set('background-size', cs.maskSize || cs.webkitMaskSize);
    set('background-position', cs.maskPosition || cs.webkitMaskPosition);
    set('background-repeat', cs.maskRepeat || cs.webkitMaskRepeat);
    set('background-origin', cs.maskOrigin || 'border-box');
    set('background-clip', cs.maskClip || 'border-box');
    set('background-color', 'transparent');
    set('mask-image', 'none');
    set('-webkit-mask-image', 'none');
    converted++;
  }
  return converted;
}
