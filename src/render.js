/**
 * Everything that happens inside Chromium: loading a story / docs page,
 * waiting until it is really finished, and printing it.
 */
import { entryLabel } from './util.js';
import { fitForPrint } from './fit.js';

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
export async function renderEntry(page, { base, entry, css, pdfOptions, printWidth, delay = 0, beforeRender }) {
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

  await settle(page, delay);

  // Scroll containers can't scroll on paper: expand / open / scale them.
  await page.emulateMedia({ media: 'print' });
  try {
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
 * Waits for network, fonts, images and animations to calm down, so the PDF
 * shows the final state. Bounded in time: a misbehaving page delays the
 * export, it never hangs it.
 */
export async function settle(page, delay = 0) {
  await page.waitForLoadState('networkidle', { timeout: SETTLE_MAX_MS }).catch(() => {});
  await page.evaluate(
    async ({ quietMs, maxMs }) => {
      const work = (async () => {
        // Lazy images below the fold would never load (and never fire onload).
        for (const img of document.images) if (img.loading === 'lazy') img.loading = 'eager';
        await document.fonts?.ready;
        await Promise.all(
          [...document.images]
            .filter((img) => !img.complete)
            .map((img) => new Promise((r) => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); })),
        );
        // Finish CSS animations / transitions so we don't print a half-faded state.
        for (const a of document.getAnimations?.() ?? []) {
          try { a.finish(); } catch {}
        }
        // Lazy parts (inline stories in docs, code snippets) keep mutating the
        // DOM for a moment after the render event: wait for a quiet period.
        await new Promise((resolve) => {
          let timer;
          const done = () => { observer.disconnect(); resolve(); };
          const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, quietMs); });
          observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
          timer = setTimeout(done, quietMs);
        });
      })();
      await Promise.race([work, new Promise((r) => setTimeout(r, maxMs))]);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    },
    { quietMs: QUIET_MS, maxMs: SETTLE_MAX_MS },
  );
  if (delay) await page.waitForTimeout(delay);
}
