/**
 * Page preparations that run in the browser right before printing. Every
 * exported function is self-contained on purpose: they are serialised and
 * evaluated in the page.
 *
 * They walk the composed tree, so content inside open shadow roots (web
 * components) and slotted children are found too.
 *
 * Opt out per element with the class `sb-print-no-fit`.
 */

/**
 * Waits until the page is finished: custom elements are defined and hydrated
 * (web components often render after Storybook's "rendered" event), the DOM,
 * including open shadow roots, has stopped changing, images (also inside
 * shadow roots) and fonts are loaded and animations are finished.
 *
 * Bounded in time: a misbehaving page delays the export, it never hangs it.
 *
 * @param {{ quietMs: number, maxMs: number, defineMs?: number }} options
 *   `defineMs` caps the wait for custom elements that never get defined.
 */
export async function settlePage({ quietMs, maxMs, defineMs = 3000 }) {
  const started = performance.now();
  const left = () => Math.max(0, maxMs - (performance.now() - started));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Every element, including those in open shadow roots.
  const elements = () => {
    const out = [];
    const collect = (root) => {
      for (const el of root.querySelectorAll('*')) {
        out.push(el);
        if (el.shadowRoot) collect(el.shadowRoot);
      }
    };
    collect(document);
    return out;
  };

  // Tags that never got defined in time are not waited for again (also not
  // in a later settle on the same page).
  const gaveUp = (window.__sbPdfUndefinedTags ??= new Set());
  const waitForDefinitions = async () => {
    const tags = new Set(elements().filter((el) => el.matches(':not(:defined)') && el.localName.includes('-')).map((el) => el.localName));
    for (const tag of gaveUp) tags.delete(tag);
    if (!tags.size) return false;
    let timedOut = false;
    await Promise.race([
      Promise.all([...tags].map((tag) => customElements.whenDefined(tag))),
      sleep(Math.min(defineMs, left())).then(() => { timedOut = true; }),
    ]);
    if (timedOut) for (const tag of tags) if (!customElements.get(tag)) gaveUp.add(tag);
    return true;
  };

  const waitForMedia = async () => {
    const images = elements().filter((el) => el.localName === 'img');
    // Lazy images below the fold would never load (and never fire onload).
    for (const img of images) if (img.loading === 'lazy') img.loading = 'eager';
    const pending = images.filter((img) => !img.complete);
    await document.fonts?.ready;
    await Promise.all(
      pending.map((img) => new Promise((r) => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); })),
    );
    // Finish CSS animations / transitions so we don't print a half-faded state.
    for (const a of document.getAnimations?.() ?? []) {
      try { a.finish(); } catch {}
    }
    return pending.length > 0;
  };

  // Resolves once nothing changed for `quietMs`: light DOM and every open
  // shadow root, also shadow roots that appear while waiting (hydration).
  const quiet = () =>
    new Promise((resolve) => {
      const options = { subtree: true, childList: true, characterData: true, attributes: true };
      const roots = new Set();
      const observers = [];
      let timer;
      const bump = () => { clearTimeout(timer); timer = setTimeout(done, quietMs); };
      const watch = (root) => {
        if (roots.has(root)) return false;
        roots.add(root);
        const observer = new MutationObserver(bump);
        observer.observe(root, options);
        observers.push(observer);
        return true;
      };
      const scan = () => elements().reduce((added, el) => (el.shadowRoot && watch(el.shadowRoot)) || added, false);
      const poll = setInterval(() => scan() && bump(), 50);
      const cap = setTimeout(() => done(), left());
      function done() {
        observers.forEach((o) => o.disconnect());
        clearTimeout(timer);
        clearTimeout(cap);
        clearInterval(poll);
        resolve();
      }
      watch(document.body);
      scan();
      bump();
    });

  const work = (async () => {
    // A few rounds: hydration can add images, images can add nothing, etc.
    for (let round = 0; round < 4 && left() > 0; round++) {
      const defined = await waitForDefinitions();
      const loaded = await waitForMedia();
      await quiet();
      if (!defined && !loaded) break;
    }
  })();
  await Promise.race([work, sleep(maxMs)]);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

/**
 * Paper can't click: print every tab of a tab set instead of only the active
 * one, each under its tab label, and hide the tab bar.
 *
 * Tab sets are found by their ARIA roles (`role="tablist"`, `role="tab"`,
 * `role="tabpanel"`) anywhere in the composed tree: open shadow roots and
 * slotted content included. A tab list is matched only to its own panels:
 * through `aria-controls` when every tab links to a panel, otherwise by order
 * among the panels next to the tab list, leaving out panels of other and of
 * nested tab sets.
 *
 *   - Every tab has its own panel in the DOM (inactive ones `hidden`, or
 *     hidden by the component's CSS, as in most web components and
 *     Radix-style tabs): the panels are revealed where they are, in tab
 *     order, keeping their slots, content and styles. Nothing is clicked.
 *   - Only the active panel exists (most React tab components): each tab is
 *     clicked in turn and its panel copied; content in shadow roots and slots
 *     is copied as it is rendered.
 *
 * Nested tab sets are expanded once their parent panel is visible. Tab sets
 * that can't be expanded are reported in `skipped`.
 *
 * @returns {Promise<{ tabsets: number, tabs: number, skipped: string[] }>}
 */
export async function expandTabs({ quietMs = 150, maxMs = 3000, budgetMs = 20_000, maxRounds = 8 } = {}) {
  const LABEL_CSS = `
    .sb-pdf-tab + .sb-pdf-tab, * + .sb-pdf-tab-label { margin-top: 14pt; }
    .sb-pdf-tab-label {
      display: block; margin: 0 0 6pt; padding-bottom: 3pt; border-bottom: 1px solid #c8c8c8;
      font: 600 10.5pt/1.3 system-ui, sans-serif; color: #222; break-after: avoid;
    }`;
  const OPTED_OUT = '.sb-print-no-fit, .sb-pdf-tabs';
  const stats = { tabsets: 0, tabs: 0, skipped: [] };
  const deadline = performance.now() + budgetMs;
  const processed = new WeakSet();

  // ---- Composed tree helpers (shadow roots + slots) -------------------------
  const assigned = (slot) => {
    const nodes = slot.assignedNodes({ flatten: true });
    return nodes.length ? nodes : [...slot.childNodes];
  };
  const childNodesOf = (el) => (el.shadowRoot ? [...el.shadowRoot.childNodes] : el.localName === 'slot' ? assigned(el) : [...el.childNodes]);
  const childrenOf = (el) => childNodesOf(el).filter((n) => n.nodeType === Node.ELEMENT_NODE);
  /** All elements below `root` in rendering order; doesn't descend into elements for which `stop` is true. */
  const descendants = (root, stop) => {
    const out = [];
    const visit = (el) => {
      for (const child of childrenOf(el)) {
        out.push(child);
        if (!stop?.(child)) visit(child);
      }
    };
    visit(root);
    return out;
  };
  const parentOf = (el) => el.assignedSlot ?? el.parentElement ?? el.parentNode?.host ?? null;
  const ancestry = (el) => {
    const out = [];
    for (let node = el; node; node = parentOf(node)) out.push(node);
    return out;
  };
  const closest = (el, selector) => ancestry(el).find((node) => node.matches?.(selector)) ?? null;
  const textOf = (el) => {
    let text = '';
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) text += node.data;
      else if (node.nodeType === Node.ELEMENT_NODE && !['style', 'script', 'template'].includes(node.localName)) childNodesOf(node).forEach(walk);
    };
    walk(el);
    return text.replace(/\s+/g, ' ').trim();
  };

  const isList = (el) => el.matches('[role="tablist"]');
  const isPanel = (el) => el.matches('[role="tabpanel"]');
  const isDisabled = (tab) => tab.disabled === true || tab.hasAttribute('disabled') || tab.getAttribute('aria-disabled') === 'true';
  const shown = (el) => el.isConnected && el.getClientRects().length > 0;
  const hide = (el) => el.style.setProperty('display', 'none', 'important');

  /** The element a tab's `aria-controls` points to. IDs only count in the tab's own tree (document or shadow root). */
  const controlled = (tab) => {
    const id = tab.getAttribute('aria-controls')?.trim().split(/\s+/)[0];
    const target = id ? tab.getRootNode().getElementById?.(id) : null;
    return target && !ancestry(tab).includes(target) ? target : null;
  };

  /**
   * Panels that belong to `list`, by order: the nearest ancestor that has any
   * panels, not looking into panels (their nested tab sets) nor other tab
   * lists. With several tab lists in that ancestor, a list owns the panels
   * between it and the next list (panels before the first list go to it).
   */
  const ownPanels = (list) => {
    for (let scope = parentOf(list); scope; scope = parentOf(scope)) {
      const sequence = [];
      const visit = (el) => {
        for (const child of childrenOf(el)) {
          if (isList(child)) sequence.push({ list: child });
          else if (isPanel(child)) sequence.push({ panel: child });
          else if (!child.matches('.sb-pdf-tabs, .sb-pdf-tab-label')) visit(child);
        }
      };
      visit(scope);
      if (!sequence.some((s) => s.panel)) continue;
      const lists = sequence.filter((s) => s.list).map((s) => s.list);
      let owner = lists[0];
      const own = [];
      for (const s of sequence) {
        if (s.list) owner = s.list;
        else if (owner === list) own.push(s.panel);
      }
      return own;
    }
    return [];
  };

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
  const labelText = (tab, i) => textOf(tab) || tab.getAttribute('aria-label')?.trim() || tab.title?.trim() || `Tab ${i + 1}`;
  const labelFor = (tab, i) => {
    const label = document.createElement('div');
    label.className = 'sb-pdf-tab-label';
    label.textContent = labelText(tab, i);
    return label;
  };

  // Resolves once nothing changed for `quietMs` in the light DOM or any open
  // shadow root (bounded by `maxMs`).
  const quiet = () =>
    new Promise((resolve) => {
      const options = { subtree: true, childList: true, characterData: true, attributes: true };
      const roots = new Set();
      const observers = [];
      let timer;
      const bump = () => { clearTimeout(timer); timer = setTimeout(done, quietMs); };
      const watch = (root) => {
        if (roots.has(root)) return false;
        roots.add(root);
        const observer = new MutationObserver(bump);
        observer.observe(root, options);
        observers.push(observer);
        return true;
      };
      const scan = () => {
        let added = false;
        const collect = (root) => {
          for (const el of root.querySelectorAll('*')) if (el.shadowRoot) { added = watch(el.shadowRoot) || added; collect(el.shadowRoot); }
        };
        collect(document);
        return added;
      };
      const poll = setInterval(() => scan() && bump(), 50);
      const cap = setTimeout(() => done(), maxMs);
      function done() {
        observers.forEach((o) => o.disconnect());
        clearTimeout(timer);
        clearTimeout(cap);
        clearInterval(poll);
        resolve();
      }
      watch(document.body);
      scan();
      bump();
    });

  // ---- Copies for the click-through path ------------------------------------
  const SKIPPED_TAGS = new Set(['style', 'script', 'template', 'link', 'meta', 'noscript']);
  const REPLACED = new Set(['img', 'svg', 'canvas', 'video', 'iframe', 'input', 'select', 'textarea', 'picture', 'object', 'embed']);
  const BLOCKISH = /^(block|flex|grid|list-item|table|flow-root)$/;
  const copyStyle = (cs, out, keepSize) => {
    for (let i = 0; i < cs.length; i++) {
      const prop = cs[i];
      if (/^(transition|animation|will-change)/.test(prop)) continue;
      if (!keepSize && /^(width|height|inline-size|block-size)$/.test(prop)) continue;
      out.style.setProperty(prop, cs.getPropertyValue(prop));
    }
  };
  const pseudo = (el, which) => {
    const cs = getComputedStyle(el, which);
    const content = cs.content.match(/^"(.*)"$/s)?.[1];
    if (content == null) return null;
    const span = document.createElement('span');
    span.textContent = content;
    copyStyle(cs, span, true);
    span.style.setProperty('content', 'normal');
    return span;
  };
  /**
   * Copy of a panel as it is rendered: shadow roots and slots are flattened
   * into plain elements with their computed styles inlined, so the copy keeps
   * its look outside the component (and doesn't re-run any component code).
   */
  const flatten = (panel) => {
    const visit = (node, parent) => {
      if (node.nodeType === Node.TEXT_NODE) return parent.append(node.data);
      if (node.nodeType !== Node.ELEMENT_NODE || SKIPPED_TAGS.has(node.localName)) return;
      if (node.localName === 'slot') return assigned(node).forEach((n) => visit(n, parent));
      const cs = getComputedStyle(node);
      if (cs.display === 'none') return;
      if (node instanceof SVGElement) {
        const svg = node.cloneNode(true);
        if (node.localName === 'svg') copyStyle(cs, svg, true);
        return parent.append(svg);
      }
      if (node.localName === 'canvas') {
        const img = document.createElement('img');
        try { img.src = node.toDataURL(); } catch {}
        copyStyle(cs, img, true);
        return parent.append(img);
      }
      const component = node.localName.includes('-') || node.shadowRoot;
      const out = document.createElement(component ? (cs.display.startsWith('inline') ? 'span' : 'div') : node.localName);
      for (const { name, value } of node.attributes) {
        if (!/^(id|slot|hidden|role|style|is|on.*|aria-(controls|labelledby|describedby|owns|hidden))$/i.test(name)) {
          try { out.setAttribute(name, value); } catch {}
        }
      }
      if (node.localName === 'img' && node.currentSrc) out.src = node.currentSrc;
      if (node.localName === 'input') {
        out.setAttribute('value', node.value);
        if (node.checked) out.setAttribute('checked', '');
      }
      copyStyle(cs, out, REPLACED.has(node.localName) || !BLOCKISH.test(cs.display));
      const before = pseudo(node, '::before');
      if (before) out.append(before);
      childNodesOf(node).forEach((n) => visit(n, out));
      const after = pseudo(node, '::after');
      if (after) out.append(after);
      out.style.setProperty('content', 'normal');
      parent.append(out);
    };
    const holder = document.createElement('div');
    visit(panel, holder);
    return holder.firstElementChild ?? holder;
  };
  // Light DOM only: a plain deep copy keeps page CSS working (tables, code).
  const plainCopy = (panel) => {
    const clone = panel.cloneNode(true);
    const from = panel.querySelectorAll('canvas');
    clone.querySelectorAll('canvas').forEach((canvas, i) => {
      try { canvas.getContext('2d')?.drawImage(from[i], 0, 0); } catch {}
    });
    clone.removeAttribute('hidden');
    clone.removeAttribute('role');
    for (const el of [clone, ...clone.querySelectorAll('[id]')]) el.removeAttribute('id');
    return clone;
  };
  const usesShadow = (panel) => [panel, ...descendants(panel)].some((el) => el.shadowRoot || el.localName === 'slot');
  const copy = (panel) => (usesShadow(panel) ? flatten(panel) : plainCopy(panel));
  const hasContent = (el) => el.textContent.trim().length > 0 || !!el.querySelector?.('img, svg, canvas, video, picture, iframe, object');

  // ---- 1. Every panel exists: reveal them in place --------------------------
  /** For each panel, its ancestor right below the panels' common ancestor (or the panel itself). */
  const unitsOf = (panels) => {
    if (panels.length < 2) return panels;
    const chains = panels.map(ancestry);
    const common = chains[0].find((node) => chains.every((chain) => chain.includes(node)));
    return chains.map((chain, i) => {
      const unit = chain[chain.indexOf(common) - 1] ?? panels[i];
      return unit.localName === 'slot' ? panels[i] : unit;
    });
  };
  const unhide = (el) => {
    if (el.localName === 'slot') return;
    el.removeAttribute('hidden');
    const cs = getComputedStyle(el);
    if (cs.display === 'none') el.style.setProperty('display', 'block', 'important');
    if (cs.visibility === 'hidden' || cs.visibility === 'collapse') el.style.setProperty('visibility', 'visible', 'important');
    if (cs.contentVisibility === 'hidden') el.style.setProperty('content-visibility', 'visible', 'important');
    if (el.getAttribute('aria-hidden') === 'true') el.removeAttribute('aria-hidden');
  };
  const before = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  const reveal = (tabs, panels, others) => {
    const units = unitsOf([...panels, ...others]);
    const own = units.slice(0, panels.length);
    // In tab order: move them if they are siblings in another order.
    const parent = own[0].parentNode;
    if (own.every((u) => u.parentNode === parent) && own.some((u, i) => i && !before(own[i - 1], u))) {
      const marker = document.createComment('');
      own.reduce((first, u) => (before(u, first) ? u : first)).before(marker);
      for (const unit of own) marker.before(unit);
      marker.remove();
    }
    tabs.forEach((tab, i) => {
      const unit = own[i];
      const chain = ancestry(panels[i]);
      for (const el of chain.slice(0, chain.indexOf(unit) + 1).reverse()) unhide(el);
      const label = labelFor(tab, i);
      // Right before the panel (not inside: panels can be flex / grid
      // containers). A slotted panel's label goes into the same slot.
      if (unit.slot) label.slot = unit.slot;
      unit.before(label);
      addStyles(label);
    });
    // Panels of disabled tabs stay out.
    units.slice(panels.length).forEach(hide);
  };

  // ---- 2. Only the active panel exists: click each tab and copy ------------
  const clickThrough = async (list, tabs, name) => {
    const panelOf = (tab) => controlled(tab) ?? ownPanels(list).find(shown) ?? null;
    const active = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true');
    const sections = [];
    const panels = new Set();
    const empty = [];
    let clicked = false;
    for (const [i, tab] of tabs.entries()) {
      if (tab.getAttribute('aria-selected') !== 'true') {
        tab.click();
        clicked = true;
        await quiet();
        // Still explicitly unselected: the click did nothing, the panel shown is another tab's.
        if (tab.getAttribute('aria-selected') === 'false') {
          empty.push(labelText(tab, i));
          continue;
        }
      }
      const panel = panelOf(tab);
      if (!panel || !shown(panel)) {
        empty.push(labelText(tab, i));
        continue;
      }
      // Nested tab sets in this panel first: the copy is static.
      await expandWithin(panel);
      const content = copy(panel);
      panels.add(panel);
      if (!hasContent(content)) {
        empty.push(labelText(tab, i));
        continue;
      }
      sections.push({ label: labelFor(tab, i), content });
    }
    if (empty.length) stats.skipped.push(`tabs "${name}": no content for ${empty.map((l) => `"${l}"`).join(', ')}`);
    if (sections.length < 2) {
      if (clicked && active) {
        active.click();
        await quiet();
      }
      stats.skipped.push(`tabs "${name}": could not be expanded, only the active tab is printed`);
      return 0;
    }

    const container = document.createElement('div');
    container.className = 'sb-pdf-tabs';
    for (const { label, content } of sections) {
      const section = document.createElement('div');
      section.className = 'sb-pdf-tab';
      section.append(label, content);
      container.append(section);
    }
    const first = [...panels][0];
    first.before(container);
    addStyles(container);
    for (const panel of panels) hide(panel);
    return sections.length;
  };

  const processList = async (list) => {
    processed.add(list);
    const all = descendants(list, isList).filter((el) => el.matches('[role="tab"]'));
    const tabs = all.filter((tab) => !isDisabled(tab));
    // A tab that is a real link would navigate away: leave such tab sets alone.
    const navigates = tabs.some((tab) => tab.matches('a[href]') && !tab.getAttribute('href').startsWith('#'));
    if (tabs.length < 2 || navigates) return;
    const name = tabs.map(labelText).join(', ');

    // aria-controls of every (enabled) tab, else panels in tab order.
    let panels = null;
    let others = [];
    const linked = tabs.map(controlled);
    if (linked.every(Boolean)) {
      panels = linked;
      others = all.filter((tab) => !tabs.includes(tab)).map(controlled).filter(Boolean);
    } else {
      const own = ownPanels(list);
      if (own.length === all.length) {
        panels = tabs.map((tab) => own[all.indexOf(tab)]);
        others = own.filter((panel) => !panels.includes(panel));
      } else if (own.length === tabs.length) {
        panels = own;
      }
    }
    if (panels) others = others.filter((panel) => !panels.includes(panel));

    let count;
    if (panels && new Set(panels).size === panels.length) {
      reveal(tabs, panels, others);
      count = tabs.length;
    } else {
      count = await clickThrough(list, tabs, name);
      if (!count) return;
      others.forEach(hide);
    }
    hide(list);
    stats.tabsets++;
    stats.tabs += count;
  };

  /** Visible tab lists below `root` that weren't handled yet. */
  const pending = (root) =>
    descendants(root).filter((el) => isList(el) && !processed.has(el) && shown(el) && !closest(el, OPTED_OUT));

  const expandWithin = async (root) => {
    for (const list of pending(root)) {
      if (processed.has(list) || !shown(list)) continue;
      if (performance.now() > deadline) {
        processed.add(list);
        stats.skipped.push(`tabs "${descendants(list, isList).filter((el) => el.matches('[role="tab"]')).map(labelText).join(', ')}": time budget for expanding tabs used up`);
        continue;
      }
      await processList(list);
    }
  };

  // Rounds: tab sets inside panels revealed in one round show up in the next.
  for (let round = 0; round < maxRounds; round++) {
    if (!pending(document.body).length) break;
    await expandWithin(document.body);
    await quiet();
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
