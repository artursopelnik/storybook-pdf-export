import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fitOnPrintScript } from '../fit.js';

const printCss = readFileSync(fileURLToPath(new URL('../print.css', import.meta.url)), 'utf8');

/**
 * Storybook preset.
 *
 *   // .storybook/main.js
 *   addons: [
 *     { name: 'storybook-pdf-export', options: { pdfUrl: 'storybook.pdf' } },
 *   ]
 *
 * Options:
 *   pdfUrl    URL of the exported PDF, relative to the Storybook root
 *             (default "storybook.pdf"). Set to false to hide the download button.
 *   printCss  Inject the print stylesheet into the preview (default true).
 */

export const managerEntries = (entry = []) => [
  ...entry,
  fileURLToPath(new URL('./manager.js', import.meta.url)),
];

export const managerHead = (head = '', options = {}) => {
  const config = { pdfUrl: options.pdfUrl ?? 'storybook.pdf' };
  return `${head}\n<script>window.__STORYBOOK_PDF_EXPORT__ = ${JSON.stringify(config).replace(/</g, '\\u003c')};</script>`;
};

export const previewHead = (head = '', options = {}) => {
  if (options.printCss === false) return head;
  return `${head}\n<style data-storybook-pdf-export>\n${printCss}\n</style>\n<script data-storybook-pdf-export>${fitOnPrintScript()}</script>`;
};
