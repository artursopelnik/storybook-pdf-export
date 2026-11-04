#!/usr/bin/env node
/**
 * Smoke test against a real Storybook build (test/fixtures/storybook).
 * Catches breakage when Storybook changes its DOM or CSS classes, which the
 * fake build in the e2e tests cannot.
 *
 *   npm run test:smoke   # installs + builds the fixture, then runs this
 */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';
import { exportPdf } from '../src/index.js';

const source = fileURLToPath(new URL('./fixtures/storybook/storybook-static', import.meta.url));
const checks = [];

const result = await exportPdf({
  source,
  output: null,
  title: 'Smoke',
  chromium: process.env.STORYBOOK_PDF_CHROMIUM,
  log: (m) => console.log(m),
  strict: true,
  hooks: {
    // Inspect the real DOM in print mode right before it is printed.
    beforeRender: async ({ page, entry }) => {
      // A4 minus the default margins is ~178 mm ≈ 674 CSS px wide.
      const viewport = page.viewportSize();
      await page.setViewportSize({ width: 674, height: 900 });
      await page.emulateMedia({ media: 'print' });
      const dom = await page.evaluate(() => {
        // The addon bakes print.css into the build; drop that copy so only the
        // stylesheet injected by the exporter is under test.
        document.querySelector('style[data-storybook-pdf-export]')?.remove();
        const visible = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.getBoundingClientRect().height > 0).length;
        return {
          stories: visible('.docs-story'),
          toolbars: visible('[aria-label="Zoom in"], .sbdocs-preview-actions, .docblock-code-toggle'),
          printOnly: visible('.sb-print-only'),
          noPrint: visible('.sb-no-print'),
          overflowing: [...document.querySelectorAll('#storybook-docs pre, #storybook-docs table')]
            .filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
            .map((e) => e.tagName),
        };
      });
      await page.emulateMedia({ media: null });
      await page.setViewportSize(viewport);
      checks.push({ id: entry.id, ...dom });
    },
  },
});

const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
console.log(checks);

assert.deepEqual(result.failed, []);
assert.ok(result.entries.some((e) => e.id === 'components-forms-button--docs'), 'autodocs page exported');
assert.ok(!result.entries.some((e) => e.id === 'components-badge--hidden'), '"no-pdf" tag respected');

const button = byId['components-forms-button--docs'];
assert.ok(button.stories >= 4, `story previews visible in print (got ${button.stories})`);
assert.equal(button.toolbars, 0, 'zoom toolbar / copy buttons hidden in print');

const intro = byId['introduction--docs'];
assert.equal(intro.printOnly, 1, '.sb-print-only visible in print');
assert.equal(intro.noPrint, 0, '.sb-no-print hidden in print');
for (const c of checks) assert.deepEqual(c.overflowing, [], `${c.id}: code blocks and tables fit the page width`);

const doc = await PDFDocument.load(result.bytes);
assert.ok(doc.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict), 'bookmarks present');
assert.ok(result.pages >= 6, `page count ${result.pages}`);

console.log(`\n✓ Smoke test passed: ${result.pages} pages, ${result.entries.length} entries`);
