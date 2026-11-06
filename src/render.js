/**
 * Everything that happens inside Chromium: loading a story / docs page,
 * waiting until it is really finished, and printing it.
 */
import { entryLabel } from './util.js';
import { fitForPrint } from './fit.js';
import { expandTabs as expandTabsInPage, inPage, settlePage, vectorizeMasks } from './prepare.js';

/** How long the DOM has to stay unchanged before a page counts as rendered. */
const QUIET_MS = 400;
/** Upper bound for the in-page settle phase (images, fonts, DOM quiet). */
const SETTLE_MAX_MS = 10_000;

/**
 * Runs in the page before Storybook boots: listens for the render events on
 * Storybook's channel. If no channel shows up within a few seconds (very old
 * or customised setups) the DOM-based check in `waitForStorybook` takes over.
 */
export function listenForRender() {
  // Tells the addon's print script (baked into the build) that the exporter is in charge.
  window.__STORYBOOK_PDF_EXPORT__ = true;
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

/** Opens a docs page or story, waits until it is rendered and returns its PDF. */
export async function renderEntry(page, { base, entry, css, pdfOptions, printWidth, delay = 0, expandTabs = true, beforeRender, warn }) {
  const viewMode = entry.type === 'docs' ? 'docs' : 'story';
  const url = new URL(`iframe.html?id=${encodeURIComponent(entry.id)}&viewMode=${viewMode}`, base);

  await page.goto(url.href, { waitUntil: 'load' });
  await page.addStyleTag({ content: css });
  await waitForStorybook(page, viewMode);

  if (viewMode === 'story') {
    await page.evaluate((text) => {
      const h = document.createElement('div');
      h.className = 'sb-pdf-story-header';
      h.textContent = text;
      h.style.cssText = 'font:600 12pt/1.3 system-ui,sans-serif;margin:0 0 12pt;padding-bottom:6pt;border-bottom:1px solid #ccc;color:#222';
      document.body.prepend(h);
    }, entryLabel(entry));
  }

  // Paper can't click: show every tab, not just the active one. Storybook's
  // "rendered" event can come before web components hydrate, so settle first
  // (custom elements defined, DOM and shadow roots quiet); settle again after
  // expanding, so images and fonts in the revealed panels load too.
  let changed = true;
  if (expandTabs) {
    await settle(page);
    const stats = await page.evaluate(inPage(expandTabsInPage));
    for (const msg of stats.skipped) warn?.(`⚠ ${entryLabel(entry)}: ${msg}`);
    changed = stats.tabsets > 0;
  }
  if (changed) await settle(page, delay);
  else if (delay) await page.waitForTimeout(delay);

  // Scroll containers can't scroll on paper: expand / open / scale them.
  await page.emulateMedia({ media: 'print' });
  try {
    await page.evaluate(inPage(vectorizeMasks));
    await page.evaluate(fitForPrint, { width: printWidth });
    if (beforeRender) await beforeRender({ page, entry });
    return await page.pdf(pdfOptions);
  } finally {
    await page.emulateMedia({ media: null });
  }
}

async function waitForStorybook(page, viewMode) {
  // Wait for Storybook's own "rendered" event (falls back to the DOM for
  // older versions), or bail out on its error / no-preview screens.
  const state = await page
    .waitForFunction(
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
    )
    .then((h) => h.jsonValue());

  if (state === 'error') {
    const msg = await page
      .locator('#error-message, .sb-errordisplay_main')
      .first()
      .innerText({ timeout: 1000 })
      .catch(() => 'Unknown error');
    throw new Error(`Storybook error: ${msg.trim()}`);
  }
  if (state === 'nopreview') throw new Error('Storybook shows "No Preview" for this entry');
}

/** Renders a complete HTML document (cover, TOC, overlay …) to PDF. */
export async function renderHtml(page, html, pdfOptions) {
  await page.setContent(html, { waitUntil: 'load' });
  await settle(page, 0);
  return page.pdf(pdfOptions);
}

/**
 * Waits for network, web component hydration, fonts, images and animations to
 * calm down, so the PDF shows the final state. Bounded in time: a misbehaving page delays the
 * export, it never hangs it.
 */
export async function settle(page, delay = 0) {
  await page.waitForLoadState('networkidle', { timeout: SETTLE_MAX_MS }).catch(() => {});
  await page.evaluate(inPage(settlePage, { quietMs: QUIET_MS, maxMs: SETTLE_MAX_MS }));
  if (delay) await page.waitForTimeout(delay);
}
