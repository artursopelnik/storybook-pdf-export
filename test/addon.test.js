import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { managerEntries, managerHead, previewHead } from '../src/addon/preset.js';

test('managerEntries registers the toolbar', () => {
  const entries = managerEntries(['existing.js']);
  assert.equal(entries[0], 'existing.js');
  assert.match(entries[1], /addon[\\/]manager\.js$/);
  assert.ok(existsSync(entries[1]));
});

test('managerHead passes options and cannot break out of the script tag', () => {
  assert.match(managerHead('', {}), /"pdfUrl":"storybook.pdf"/);
  assert.match(managerHead('<meta>', { pdfUrl: false }), /^<meta>[\s\S]*"pdfUrl":false/);
  const head = managerHead('', { pdfUrl: '</script><script>alert(1)</script>' });
  assert.equal(head.match(/<\/script>/g).length, 1);
});

test('previewHead injects print.css unless disabled', () => {
  assert.match(previewHead('', {}), /data-storybook-pdf-export[\s\S]*@media print/);
  assert.equal(previewHead('<x>', { printCss: false }), '<x>');
});
