/**
 * Page preparations that run in the browser right before printing. Both
 * functions are self-contained on purpose: they are serialised and evaluated
 * in the page.
 *
 * They walk the flat tree, so content inside open shadow roots (web
 * components) and slotted children are found too.
 *
 * Opt out per element with the class `sb-print-no-fit`.
 */

/**
 * Paper can't click: print every tab of a tab set instead of only the active
 * one, each under its tab label, and hide the tab bar.
 *
 * Tab sets are found by their ARIA roles: `role="tablist"`, `role="tab"`,
 * `role="tabpanel"` (linked with `aria-controls`, or panels next to the tab
 * list in the same order as the tabs).
 *
 *   - Every tab has its own panel in the DOM (inactive ones `hidden`, as in
 *     most web components and Radix-style tabs): the panels are revealed
 *     where they are.
 *   - Only the active panel exists (most React tab components): each tab is
 *     clicked in turn and its panel copied.
 *
 * @returns {Promise<{ tabsets: number, tabs: number }>}
 */
export async function expandTabs({ quietMs = 150, maxMs = 3000 } = {}) {
  const LABEL_CSS = `
    .sb-pdf-tab + .sb-pdf-tab, * + .sb-pdf-tab-label { margin-top: 14pt; }
    .sb-pdf-tab-label {
      display: block; margin: 0 0 6pt; padding-bottom: 3pt; border-bottom: 1px solid #c8c8c8;
      font: 600 10.5pt/1.3 system-ui, sans-serif; color: #222; break-after: avoid;
    }`;
  const stats = { tabsets: 0, tabs: 0 };

  // ---- Flat tree helpers (shadow roots + slots) ----------------------------
  const childrenOf = (el) => {
    if (el.shadowRoot) return [...el.shadowRoot.children];
    if (el.localName === 'slot') {
      const assigned = el.assignedElements({ flatten: true });
      return assigned.length ? assigned : [...el.children];
    }
    return [...el.children];
  };
  /** All elements below `root` in rendering order; doesn't descend into elements matching `stop`. */
  const descendants = (root, stop) => {
    const out = [];
    const visit = (el) => {
      for (const child of childrenOf(el)) {
        out.push(child);
        if (!(stop && child.matches(stop))) visit(child);
      }
    };
    visit(root);
    return out;
  };
  const parentOf = (el) => el.assignedSlot ?? el.parentElement ?? el.parentNode?.host ?? null;
  const closest = (el, selector) => {
    for (let node = el; node; node = parentOf(node)) if (node.matches?.(selector)) return node;
    return null;
  };
  const byId = (from, id) => {
    if (!id) return null;
    const local = from.getRootNode().getElementById?.(id);
    if (local) return local;
    return document.getElementById(id) ?? descendants(document.documentElement).find((el) => el.id === id) ?? null;
  };

  const shown = (el) => el.getClientRects().length > 0;
  const hide = (el) => el.style.setProperty('display', 'none', 'important');

  // print.css doesn't reach into shadow roots: give them the label styles.
  const styled = new WeakSet();
  const addStyles = (node) => {
    const root = node.getRootNode();
    if (!(root instanceof ShadowRoot) || styled.has(root)) return;
    const style = document.createElement('style');
    style.textContent = LABEL_CSS;
    root.append(style);
    styled.add(root);
  };
  const labelFor = (tab, i) => {
    const label = document.createElement('div');
    label.className = 'sb-pdf-tab-label';
    label.textContent = (tab.innerText || tab.textContent || tab.getAttribute('aria-label') || tab.title || '').trim() || `Tab ${i + 1}`;
    return label;
  };

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

  // ---- 1. Every panel exists: reveal them in place --------------------------
  const reveal = (tabs, panels) => {
    tabs.forEach((tab, i) => {
      const panel = panels[i];
      panel.removeAttribute('hidden');
      if (!shown(panel)) panel.style.setProperty('display', 'block', 'important');
      const label = labelFor(tab, i);
      // Right before the panel (not inside: panels can be flex / grid
      // containers). A slotted panel's label goes into the same slot.
      if (panel.slot) label.slot = panel.slot;
      panel.before(label);
      addStyles(label);
    });
  };

  // ---- 2. Only the active panel exists: click each tab and copy ------------
  const clickThrough = async (tabs, panelOf) => {
    const sections = [];
    const panels = new Set();
    for (const [i, tab] of tabs.entries()) {
      if (tab.getAttribute('aria-selected') !== 'true') {
        tab.click();
        await quiet();
      }
      const panel = panelOf(tab);
      if (!panel) continue;
      panels.add(panel);
      sections.push({ label: labelFor(tab, i), content: copy(panel) });
    }
    if (sections.length < 2) return 0;

    const container = document.createElement('div');
    container.className = 'sb-pdf-tabs';
    for (const { label, content } of sections) {
      const section = document.createElement('div');
      section.className = 'sb-pdf-tab';
      section.append(label, content);
      container.append(section);
    }
    const first = [...panels][0];
    first.parentNode.insertBefore(container, first);
    addStyles(container);
    for (const panel of panels) hide(panel);
    return sections.length;
  };

  const lists = descendants(document.body).filter(
    (el) => el.matches('[role="tablist"]') && shown(el) && !closest(el, '.sb-print-no-fit, .sb-pdf-tabs'),
  );

  for (const list of lists) {
    const all = descendants(list, '[role="tablist"]').filter((el) => el.matches('[role="tab"]'));
    const tabs = all.filter((tab) => !tab.disabled && tab.getAttribute('aria-disabled') !== 'true');
    // A tab that is a real link would navigate away: leave such tab sets alone.
    const navigates = tabs.some((tab) => tab.matches('a[href]') && !tab.getAttribute('href').startsWith('#'));
    if (tabs.length < 2 || navigates) continue;

    // Panels next to the tab list: the nearest ancestor that has any.
    let nearby = [];
    for (let scope = parentOf(list); scope && !nearby.length; scope = parentOf(scope)) {
      nearby = descendants(scope).filter((el) => el.matches('[role="tabpanel"]') && !closest(el, '.sb-pdf-tabs'));
    }
    const linked = all.map((tab) => byId(tab, tab.getAttribute('aria-controls')));
    // aria-controls for every tab, else panels in the same order as the tabs.
    const panelsOfAll = linked.every(Boolean) ? linked : nearby.length === all.length ? nearby : null;
    const panels = panelsOfAll && tabs.map((tab) => panelsOfAll[all.indexOf(tab)]);

    let count;
    if (panels && new Set(panels).size === panels.length) {
      reveal(tabs, panels);
      count = tabs.length;
    } else {
      const panelOf = (tab) => byId(tab, tab.getAttribute('aria-controls')) ?? nearby.find(shown) ?? null;
      count = await clickThrough(tabs, panelOf);
      if (!count) continue;
    }
    hide(list);
    // Panels of disabled tabs stay out.
    if (panelsOfAll) all.forEach((tab, i) => tabs.includes(tab) || hide(panelsOfAll[i]));
    stats.tabsets++;
    stats.tabs += count;
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

  // Every element, including those in open shadow roots.
  const elements = [];
  const collect = (root) => {
    for (const el of root.querySelectorAll('*')) {
      elements.push(el);
      if (el.shadowRoot) collect(el.shadowRoot);
    }
  };
  collect(document.body);
  const optedOut = (el) => {
    for (let node = el; node; node = node.parentElement ?? node.parentNode?.host) {
      if (node.classList?.contains('sb-print-no-fit')) return true;
    }
    return false;
  };

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
  for (const el of elements) {
    const cs = getComputedStyle(el);
    const mask = cs.maskImage && cs.maskImage !== 'none' ? cs.maskImage : cs.webkitMaskImage;
    if (!mask || mask === 'none') continue;
    const url = mask.match(/^url\("?(.*?)"?\)$/s)?.[1]; // one mask layer only
    const color = cs.backgroundColor;
    if (!url || cs.backgroundImage !== 'none' || TRANSPARENT.test(color) || optedOut(el)) continue;

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
