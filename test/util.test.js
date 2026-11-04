import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isUrl, firstLine, formatTitle, entryLabel, plural, readProjectPackage } from '../src/util.js';

test('small helpers', () => {
  assert.ok(isUrl('http://localhost:6006'));
  assert.ok(isUrl('HTTPS://x.test'));
  assert.ok(!isUrl('./storybook-static'));
  assert.ok(!isUrl('C:\\\\sb'));
  assert.equal(firstLine(new Error('a\nb')), 'a');
  assert.equal(firstLine('plain'), 'plain');
  assert.equal(formatTitle('Components / Forms/Button'), 'Components › Forms › Button');
  assert.equal(entryLabel({ title: 'A/B', name: 'Docs' }), 'A › B › Docs');
  assert.equal(plural(1, 'entry', 'entries'), '1 entry');
  assert.equal(plural(3, 'entry', 'entries'), '3 entries');
});

test('readProjectPackage finds the package.json next to the build', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sb-pdf-pkg-'));
  try {
    await mkdir(join(dir, 'storybook-static'));
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'acme-ds', version: '1.0.0' }));
    assert.deepEqual(await readProjectPackage(join(dir, 'storybook-static')), { name: 'acme-ds', version: '1.0.0' });
    assert.deepEqual(await readProjectPackage('http://localhost:6006'), {});
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('toPx / printableWidth', async () => {
  const { toPx, printableWidth } = await import('../src/util.js');
  assert.equal(toPx(10), 10);
  assert.equal(toPx('1in'), 96);
  assert.equal(Math.round(toPx('25.4mm')), 96);
  assert.equal(Math.round(toPx('2.54cm')), 96);
  assert.equal(toPx('72pt'), 96);
  assert.throws(() => toPx('1em'), /Unsupported length/);
  const margin = { left: '16mm', right: '16mm' };
  assert.equal(printableWidth({ format: 'A4', margin }), 672); // 210mm - 32mm = 178mm
  assert.ok(printableWidth({ format: 'a4', landscape: true, margin }) > 1000);
  assert.equal(printableWidth({ format: 'Letter', margin: { left: '0.5in', right: '0.5in' } }), 720);
  assert.throws(() => printableWidth({ format: 'Napkin' }), /Unknown paper format/);
});
